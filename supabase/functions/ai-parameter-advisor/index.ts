import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// LOCKED_PARAMS: Kern-Sicherheitsparameter, die NIEMALS von KI geschrieben werden dürfen
// (auch wenn versehentlich in der Whitelist als 'auto' markiert). Lesen + Empfehlen ist OK,
// Insert in ai_parameter_decisions und Auto-Apply auf heating_settings sind hart geblockt.
const LOCKED_PARAMS = new Set<string>([
  // SOC-Parameter: konsolidiert in „KI Batterie-Empfehlung" (battery_soc_suggestions).
  // Werden NIEMALS über die generische Parameter-Pipeline vorgeschlagen oder geschrieben.
  'heating_min_battery_soc',
  'battery_reserve_for_night_soc',
  'micro_budget_min_battery_soc',
  // Weitere Kern-Safety-Parameter
  'pv_surplus_threshold_on',
  'pv_surplus_threshold_off',
  'night_start_time',
  'night_end_time',
]);


// ---------------------------------------------------------------------------
// Sub-Route: POST /suggest-battery-soc
// Erstellt einen KI-Vorschlag zur Anpassung von heating_min_battery_soc.
// Schreibt NUR in battery_soc_suggestions (nie in heating_settings).
// LOCKED_PARAMS guard — see mem://security/ki-locked-core-params
// ---------------------------------------------------------------------------
interface ValidationInput {
  morningSoc?: number | null;
  reserveHeld?: boolean | null;
  reserveTarget?: number | null;
  nightConsumptionKwh?: number | null;
  heatingBatteryUsedKwh?: number | null;
  suggestionText?: string | null;
}

// ---------------------------------------------------------------------------
// Batterie-Vorschlag v2 (01.11.2026, Konzept Tagesablauf §10):
// Mindest-Ladestand = was die Nacht braucht – gemessen, nicht geschätzt.
//   Nachtbedarf   = größter Ladestand-Verlust der letzten sauberen Nächte (nacht_protokoll, ab 26.10.,
//                   nur Nächte mit Ladestand abends ≥ 20 %, sonst war die Batterie schon leer)
//   + Abend/Morgen = Grundlast (aus denselben Nächten) × Stunden ohne PV vor night_start bzw. nach night_end
//                   (aus der Stundenprognose von morgen)
//   + Reserve      = battery_night_reserve_pct (Mindest-SOC des Wechselrichters + Puffer)
// Mustergedächtnis: daily_pattern_scores – ähnliche Tage (Prognose ±30 %) → wie viel PV kam wirklich
// (Korrekturfaktor). Daraus: was morgen nach Batterie-Ladung für die Heizung frei bleibt und für welche
// Räume (Priorität) es reicht. Die alte Wenn-dann-Regel (Prognose < 10 kWh → Grenze hoch) ist entfernt:
// Sie hob die Grenze gerade an trüben Tagen, an denen die Batterie sie ohnehin nicht erreicht.
// Heizungsdaten vor dem 24.10.2026 werden nicht verwendet (Thermostate liefen im Modus „auto“).
// ---------------------------------------------------------------------------
async function handleSuggestBatterySoc(sb: ReturnType<typeof createClient>, _validation?: ValidationInput) {
  const { data: hs } = await sb.from('heating_settings')
    .select('heating_min_battery_soc, battery_soc_suggestion_enabled, battery_capacity_kwh, night_start_time, night_end_time, battery_night_reserve_pct')
    .limit(1).maybeSingle();
  if (!hs) return { ok: false, skipped: 'no_heating_settings' };

  const oldValue = Number(hs.heating_min_battery_soc ?? 80);
  const enabled = hs.battery_soc_suggestion_enabled !== false;
  if (!enabled) return { ok: true, skipped: 'suggestion_disabled' };
  const cap = Number(hs.battery_capacity_kwh) || 13.8;
  const reservePct = Number(hs.battery_night_reserve_pct ?? 10);
  const hm = (v: unknown, def: number) => { const m = /^(\d{1,2})/.exec(String(v ?? '')); return m ? Number(m[1]) : def; };
  const nightStartH = hm(hs.night_start_time, 22);
  const nightEndH = hm(hs.night_end_time, 8);
  const nightHours = (24 - nightStartH) + nightEndH;

  const { data: existingRows } = await sb.from('battery_soc_suggestions')
    .select('id, new_value, reason_text').eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1);
  const existing = existingRows?.[0] ?? null;

  const vienna = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const todayStr = vienna(new Date());
  const tomorrowStr = vienna(new Date(Date.now() + 86400000));

  // 1) Nachtbedarf aus dem Nacht-Protokoll (Haus-Werte stehen je Raum wiederholt → je Nacht eine Zeile)
  const { data: nightRows } = await sb.from('nacht_protokoll')
    .select('nacht, soc_abends, soc_morgens, aussen_avg, ausgewertet_at')
    .gte('nacht', '2026-10-26').not('ausgewertet_at', 'is', null)
    .order('nacht', { ascending: false }).limit(12 * 14);
  const perNight = new Map<string, { drop: number; aussen: number | null }>();
  for (const r of (nightRows ?? []) as any[]) {
    if (perNight.has(r.nacht) || r.soc_abends == null || r.soc_morgens == null) continue;
    if (Number(r.soc_abends) < 20) continue; // Batterie war schon leer – Verlust nicht messbar
    perNight.set(r.nacht, { drop: Number(r.soc_abends) - Number(r.soc_morgens), aussen: r.aussen_avg != null ? Number(r.aussen_avg) : null });
  }
  const nights = [...perNight.entries()].slice(0, 7);
  const nightDropPct = nights.length >= 2 ? Math.max(...nights.map(([, v]) => v.drop)) : 21; // Startwert 26.–30.10.
  const baseW = (nightDropPct / 100) * cap * 1000 / nightHours;

  // 2) Stundenprognose morgen → Stunden ohne nennenswerte PV am Abend und Morgen
  const { data: fc } = await sb.from('pv_forecasts')
    .select('expected_kwh, hourly_watts').eq('date', tomorrowStr).maybeSingle();
  const pvForecastKwh = fc?.expected_kwh != null ? Number(fc.expected_kwh) : null;
  const hw = (fc?.hourly_watts ?? {}) as Record<string, number>;
  const hoursWithPv = Object.entries(hw)
    .filter(([, w]) => Number(w) >= 500)
    .map(([k]) => Number(/\s(\d{2}):/.exec(k)?.[1] ?? NaN))
    .filter((h) => Number.isFinite(h));
  const firstPvH = hoursWithPv.length ? Math.min(...hoursWithPv) : 10;
  const lastPvH = hoursWithPv.length ? Math.max(...hoursWithPv) : 15;
  const morningH = Math.max(0, firstPvH - nightEndH);
  const eveningH = Math.max(0, nightStartH - (lastPvH + 1));
  const edgePct = ((morningH + eveningH) * baseW / 1000) / cap * 100;

  // 3) Vorschlag
  const raw = nightDropPct + edgePct + reservePct;
  let newValue = Math.min(90, Math.max(30, Math.ceil(raw / 5) * 5));
  if (Math.abs(newValue - oldValue) < 5) newValue = oldValue;

  // 4) Mustergedächtnis: wie viel PV kam an ähnlichen Tagen wirklich?
  let pvReal: number | null = pvForecastKwh;
  let patternLine = 'Keine ähnlichen Tage im Mustergedächtnis.';
  if (pvForecastKwh != null && pvForecastKwh > 0) {
    const { data: sim } = await sb.from('daily_pattern_scores')
      .select('date, expected_pv_kwh, pv_kwh')
      .gte('expected_pv_kwh', pvForecastKwh * 0.7).lte('expected_pv_kwh', pvForecastKwh * 1.3)
      .not('pv_kwh', 'is', null).lt('date', todayStr)
      .order('date', { ascending: false }).limit(30);
    const ratios = ((sim ?? []) as any[])
      .filter((d) => Number(d.expected_pv_kwh) > 0)
      .map((d) => Number(d.pv_kwh) / Number(d.expected_pv_kwh))
      .filter((x) => Number.isFinite(x) && x > 0 && x < 3)
      .sort((a, b) => a - b);
    if (ratios.length >= 3) {
      const median = ratios[Math.floor(ratios.length / 2)];
      pvReal = pvForecastKwh * median;
      patternLine = `Mustergedächtnis: ${ratios.length} ähnliche Tage (Prognose ${(pvForecastKwh * 0.7).toFixed(0)}–${(pvForecastKwh * 1.3).toFixed(0)} kWh) brachten im Mittel ${Math.round(median * 100)} % der Prognose → realistisch ${pvReal.toFixed(1)} kWh.`;
    }
  }

  // 5) Was bleibt morgen für die Heizung (nach Grundlast und Laden bis zur Grenze)?
  const { data: nowE } = await sb.from('energy_readings').select('battery_soc').order('timestamp', { ascending: false }).limit(1).maybeSingle();
  const socNow = nowE?.battery_soc != null ? Number(nowE.battery_soc) : null;
  let heatLine = '';
  if (pvReal != null && socNow != null) {
    const socMorning = Math.max(5, socNow - nightDropPct);
    const dayHours = Math.max(0, lastPvH + 1 - firstPvH);
    const dayLoadKwh = baseW * dayHours / 1000;
    const toBatteryKwh = Math.max(0, (newValue - socMorning) / 100 * cap);
    const freeKwh = Math.max(0, pvReal - dayLoadKwh - toBatteryKwh);
    const { data: rooms } = await sb.from('rooms')
      .select('name, priority, heating_power_w, calculated_power_w, automation_enabled')
      .eq('automation_enabled', true).order('priority', { ascending: true });
    const parts: string[] = [];
    let left = freeKwh;
    for (const r of (rooms ?? []) as any[]) {
      if (left < 0.3) break;
      const w = Number(r.calculated_power_w || r.heating_power_w || 800);
      const h = Math.min(3, left / (w / 1000));
      parts.push(`${r.name} ~${h.toFixed(1)} h`);
      left -= h * w / 1000;
    }
    heatLine = `Morgen: Batterie früh ~${Math.round(socMorning)} %, Laden bis ${newValue} % braucht ${toBatteryKwh.toFixed(1)} kWh, Grundlast ${dayLoadKwh.toFixed(1)} kWh → für die Heizung frei ≈ ${freeKwh.toFixed(1)} kWh`
      + (parts.length ? ` (nach Priorität: ${parts.join(', ')}).` : ' – reicht für keinen Raum.');
  }

  // 6) Lernschleife Stufe 3 (Vorstufe): bewertete ähnliche Tage (tages_bewertung) – welche Grenze hatte die beste Note?
  let learnLine = '';
  try {
    const { data: tb } = await sb.from('tages_bewertung')
      .select('tag, note, pv_prognose_kwh, einstellungen').not('note', 'is', null).gte('tag', '2026-10-26')
      .order('tag', { ascending: false }).limit(60);
    const all = (tb ?? []) as any[];
    const similar = pvForecastKwh != null
      ? all.filter((d) => d.pv_prognose_kwh != null && Math.abs(Number(d.pv_prognose_kwh) - pvForecastKwh) <= Math.max(3, pvForecastKwh * 0.3))
      : [];
    if (similar.length >= 3) {
      const best = [...similar].sort((a, b) => Number(b.note) - Number(a.note))[0];
      const g = best.einstellungen?.heating_min_battery_soc;
      learnLine = `Lernschleife: ${similar.length} bewertete ähnliche Tage, beste Note ${best.note}/100 am ${String(best.tag).slice(8, 10)}.${String(best.tag).slice(5, 7)}.`
        + (g != null ? ` (Grenze damals ${g} %).` : '.');
    } else {
      learnLine = `Lernschleife: ${all.length} Tage bewertet, ${similar.length} ähnlich – Vorschläge aus Tagesnoten ab ~2 Wochen Daten.`;
    }
  } catch (_) { /* Tabelle fehlt (SQL 14) – ohne Lernzeile weiter */ }

  const reasonCore = `Nachtbedarf gemessen: ${nightDropPct.toFixed(0)} % (${nights.length >= 2 ? `größter Verlust aus ${nights.length} Nächten` : 'Startwert, noch zu wenige saubere Nächte'}, Grundlast ≈ ${Math.round(baseW)} W)`
    + ` + Abend/Morgen ohne PV ${morningH + eveningH} h ≈ ${edgePct.toFixed(0)} % + Reserve ${reservePct} % = ${raw.toFixed(0)} % → ${newValue} %.`;
  const pvForecastLine = pvForecastKwh != null ? `PV-Prognose morgen ${pvForecastKwh.toFixed(1)} kWh.` : 'Keine PV-Prognose für morgen.';
  const reasonText = [reasonCore, pvForecastLine, patternLine, heatLine, learnLine].filter(Boolean).join(' ');
  const avg7d = null;
  const socEnd = socNow != null ? Math.round(socNow) : null;

  if (newValue === oldValue) {
    // Kein neuer Vorschlag – Begründung trotzdem festhalten (Protokoll), offenen Vorschlag zurückziehen
    if (existing) await sb.from('battery_soc_suggestions').update({ status: 'dismissed', decided_at: new Date().toISOString(), decided_by: 'system: neue Berechnung, keine Änderung' }).eq('id', existing.id);
    await sb.from('system_settings').upsert({ key: 'battery_soc_suggestion_last', value: { at: new Date().toISOString(), old: oldValue, proposed: newValue, reason: reasonText }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return { ok: true, skipped: 'no_change_needed', oldValue, reasonText };
  }
  await sb.from('system_settings').upsert({ key: 'battery_soc_suggestion_last', value: { at: new Date().toISOString(), old: oldValue, proposed: newValue, reason: reasonText }, updated_at: new Date().toISOString() }, { onConflict: 'key' });



  // Upsert: existierenden pending-Eintrag updaten, wenn sich Wert ändert
  if (existing) {
    if (Number(existing.new_value) === newValue && existing.reason_text === reasonText) {
      return { ok: true, skipped: 'pending_unchanged', existing_id: existing.id };
    }
    const { error: updErr } = await sb.from('battery_soc_suggestions')
      .update({
        new_value: newValue,
        pv_forecast_kwh: pvForecastKwh,
        avg_pv_7d_kwh: avg7d,
        soc_end_of_day: socEnd,
        reason_text: reasonText,
      })
      .eq('id', existing.id);
    if (updErr) {
      console.error('[suggest-battery-soc] update failed', updErr);
      return { ok: false, error: updErr.message };
    }
    console.log(`[suggest-battery-soc] updated pending ${existing.id}: ${oldValue}% → ${newValue}%`);
    return { ok: true, updated: true, existing_id: existing.id };
  }

  const { data: inserted, error: insErr } = await sb.from('battery_soc_suggestions').insert({
    old_value: oldValue,
    new_value: newValue,
    pv_forecast_kwh: pvForecastKwh,
    avg_pv_7d_kwh: avg7d,
    soc_end_of_day: socEnd,
    reason_text: reasonText,
    status: 'pending',
  }).select().single();

  if (insErr) {
    console.error('[suggest-battery-soc] insert failed', insErr);
    return { ok: false, error: insErr.message };
  }

  console.log(`[suggest-battery-soc] proposed ${oldValue}% → ${newValue}% (PV ${pvForecastKwh} kWh, SOC ${socEnd}%)`);
  return { ok: true, created: true, suggestion: inserted };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Route-Dispatch: Sub-Route für Battery-SOC-Vorschläge
  const reqUrl = new URL(req.url);
  if (reqUrl.pathname.endsWith('/suggest-battery-soc')) {
    try {
      let validation: ValidationInput | undefined;
      if (req.method === 'POST') {
        try {
          const body = await req.json();
          if (body && typeof body === 'object' && body.validation && typeof body.validation === 'object') {
            validation = body.validation as ValidationInput;
          }
        } catch { /* no body or invalid JSON — ignore */ }
      }
      const result = await handleSuggestBatterySoc(sb, validation);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('[suggest-battery-soc] fatal', e);
      return new Response(JSON.stringify({ ok: false, error: String(e) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // 13.11.2026: Der Hauptpfad (Gemini schlägt Parameter vor, zuletzt manuell aus KI › Schatten-Entscheidungen) ist
  // entfernt – eine Sprach-KI rechnet nicht zuverlässig (Uli 13.11.2026). Vorschläge kommen aus der Tagesanalyse
  // (ki-tagesanalyse, feste Regeln mit Messwerten), dem Heizplaner und der Leistungsmessung.
  // Geblieben: /suggest-battery-soc (feste Rechnung, kein Sprachmodell). doc/FIX-PLANER-MODELL-2026-11-13.md
  return new Response(JSON.stringify({ ok: true, skipped: 'entfernt', message: 'KI-Parameter-Vorschläge per Sprachmodell entfernt (13.11.2026). Nur /suggest-battery-soc ist aktiv.' }), {
    status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
