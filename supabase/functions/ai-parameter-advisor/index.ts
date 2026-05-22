import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY = Deno.env.get('GOOGLE_AI_API_KEY')!;

interface WhitelistRow {
  parameter_key: string;
  scope: 'global' | 'room';
  storage_table: string;
  storage_column: string;
  data_type: string;
  min_value: number | null;
  max_value: number | null;
  allowed_values: unknown;
  autonomy_level: string;
  description: string | null;
}

function extractJSON(raw: string): any {
  let cleaned = raw
    .replace(/^```json\s*/im, '')
    .replace(/^```\s*/im, '')
    .replace(/```\s*$/im, '')
    .trim();

  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const objStart = cleaned.indexOf('{');
    const arrStart = cleaned.indexOf('[');
    const isArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
    const start = isArray ? arrStart : objStart;
    const end = isArray ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  }

  return JSON.parse(cleaned);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = new Date().toISOString();

  // Master kill-switch: ai_auto_mode_enabled
  const { data: masterRow } = await sb
    .from('system_settings')
    .select('value')
    .eq('key', 'ai_auto_mode_enabled')
    .maybeSingle();
  const autopilotEnabled = (masterRow?.value as { enabled?: boolean } | null)?.enabled !== false;

  try {
    // 1) Snapshot
    const [
      { data: whitelist },
      { data: rooms },
      { data: heatingSettings },
      { data: systemSettingsRows },
      { data: latestEnergy },
      { data: forecast },
      { data: dailyScores },
      { data: recentDecisions },
    ] = await Promise.all([
      sb.from('ai_parameter_whitelist').select('*').eq('enabled', true),
      sb.from('rooms').select('id,name,current_temp,target_temp,is_heating,eco_temp,comfort_temp,night_temp,pv_boost_max_temp,priority,automation_enabled'),
      sb.from('heating_settings').select('*').limit(1).maybeSingle(),
      sb.from('system_settings').select('key,value'),
      sb.from('energy_readings').select('timestamp,power_io,pv_power,battery_soc,consumption').order('timestamp', { ascending: false }).limit(1),
      sb.from('pv_forecasts').select('date,expected_kwh,hourly_watts').gte('date', new Date().toISOString().slice(0, 10)).order('date').limit(2),
      sb.from('daily_pattern_scores').select('date,sig_weather,sig_pv_bucket,kpi_self_consumption_ratio,kpi_pv_heating_coverage,kpi_grid_import_kwh,score').order('date', { ascending: false }).limit(7),
      sb.from('ai_parameter_decisions').select('parameter_key,proposed_value,confidence,outcome_score,created_at').order('created_at', { ascending: false }).limit(20),
    ]);

    const wl = (whitelist ?? []) as WhitelistRow[];
    if (wl.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: 'empty_whitelist' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Self-Heal: Falls daily_pattern_scores für „gestern" fehlt und es nach 04:00
    // Europe/Vienna ist (Daten sollten da sein), Backfill asynchron triggern.
    // Aktueller Lauf nutzt vorhandenen Datenstand; nächster 15-min-Tick sieht den Score.
    try {
      const viennaDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
      const yesterdayStr = new Date(viennaDate.getTime() - 86400000).toISOString().slice(0, 10);
      const hasYesterday = (dailyScores ?? []).some((r: any) => String(r.date).slice(0, 10) === yesterdayStr);
      if (!hasYesterday && viennaDate.getHours() >= 4) {
        console.log(`[ai-parameter-advisor] daily_score missing for ${yesterdayStr} — triggering backfill`);
        // Fire-and-forget
        fetch(`${SUPABASE_URL}/functions/v1/compute-daily-score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
          body: JSON.stringify({}),
        }).catch((e) => console.warn('[ai-parameter-advisor] backfill trigger failed:', e));
      }
    } catch (e) {
      console.warn('[ai-parameter-advisor] self-heal check failed:', e);
    }


    const sysMap: Record<string, unknown> = {};
    for (const r of systemSettingsRows ?? []) sysMap[(r as any).key] = (r as any).value;

    const energy = latestEnergy?.[0] ?? null;
    const today = forecast?.[0] ?? null;

    // Musteranalyse-Outputs aus analyze-patterns explizit isolieren,
    // damit der Advisor sie als eigenständige Empfehlungen sieht und nicht
    // im generischen system_settings-Dump untergehen lässt.
    const weeklyInsight = (sysMap['weekly_insight'] as any) ?? null;
    const bestMatchToday = (sysMap['best_match_today'] as any) ?? null;
    const patternRecommendations = Array.isArray(weeklyInsight?.recommendations)
      ? weeklyInsight.recommendations
      : [];

    const sysMapTrimmed: Record<string, unknown> = { ...sysMap };
    delete sysMapTrimmed['weekly_insight'];
    delete sysMapTrimmed['best_match_today'];

    const snapshot = {
      timestamp: startedAt,
      energy_now: energy,
      forecast_today: today,
      kpis_last_7d: dailyScores ?? [],
      heating_settings: heatingSettings,
      system_settings: sysMapTrimmed,
      rooms: rooms ?? [],
    };

    const patternBlock = {
      weekly_insight: weeklyInsight
        ? {
            trend: weeklyInsight.trend,
            avg_self_consumption_ratio: weeklyInsight.avg_self_consumption_ratio,
            top_grid_import_hours: weeklyInsight.top_grid_import_hours,
            summary: weeklyInsight.summary,
            computed_at: weeklyInsight.computed_at,
            recommendations: patternRecommendations,
          }
        : null,
      best_match_today: bestMatchToday
        ? {
            signature: bestMatchToday.signature,
            match_quality: bestMatchToday.match_quality,
            top_days: (Array.isArray(bestMatchToday.top_days) ? bestMatchToday.top_days : []).slice(0, 3),
            recommended_overrides: bestMatchToday.recommended_overrides,
          }
        : null,
    };

    // 2) Build prompt
    const whitelistDoc = wl.map((w) => ({
      key: w.parameter_key,
      scope: w.scope,
      type: w.data_type,
      min: w.min_value,
      max: w.max_value,
      allowed: w.allowed_values,
      description: w.description,
    }));

    const autoParams = wl.filter(w => w.autonomy_level === 'auto').map(w => w.parameter_key);
    const prompt = `Du bist ein Steuerungs-Optimierer für ein PV-Heizsystem (15.8 kWp PV, 13.8 kWh Batterie, 12 Räume mit Tuya-Thermostaten).
Deine Aufgabe: Schlage konkrete Parameter-Änderungen vor, die Eigenverbrauchsquote (SCR) und Komfort verbessern.

AUTONOMIE-LEVEL DER PARAMETER:
- shadow/suggest: Vorschläge werden nur dokumentert — der Nutzer muss bestätigen.
- auto: Die KI schreibt direkt (mit Audit-Log).
AUTO-Parameter: ${autoParams.join(', ') || 'keine'}

ERLAUBTE PARAMETER (du darfst NUR diese vorschlagen, innerhalb der Grenzen):
${JSON.stringify(whitelistDoc, null, 2)}

AKTUELLER SYSTEM-SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

MUSTERANALYSE (analyze-patterns) — explizit zu berücksichtigen:
${JSON.stringify(patternBlock, null, 2)}

REGELN FÜR DEN UMGANG MIT MUSTERANALYSE:
- weekly_insight.recommendations sind unverbindliche Hinweise — übernimm sie NUR, wenn der Key in der Whitelist steht und der Wert in den Grenzen liegt.
- Begründe in reasoning explizit, ob du einer Pattern-Empfehlung folgst ODER bewusst abweichst.
- best_match_today.recommended_overrides sind ein historisch validierter Prior für ähnliche Tage — als Hinweis nutzen, nicht blind kopieren.
- Wenn match_quality = 'none' oder weekly_insight = null: Block ignorieren.

DEINE LETZTEN ENTSCHEIDUNGEN (Lerneffekt):
${JSON.stringify(recentDecisions ?? [], null, 2)}

REGELN:
- Schlage nur Änderungen vor, die du für klar besser hältst (kein "ändern um zu ändern").
- Für room-Parameter MUSST du room_id angeben (aus dem Snapshot).
- proposed_value MUSS in den Grenzen / allowed_values liegen.
- Wenn aktueller Wert bereits gut ist: leeres decisions-Array zurückgeben.
- confidence: 0..1, ehrlich. Niedrige confidence bei Unsicherheit.
- expected_outcome: kurze Vorhersage was sich verbessern sollte (z.B. {"scr_delta": "+0.05", "comfort_delta": "+15min"}).

Antworte STRIKT als JSON:
{
  "decisions": [
    {
      "parameter_key": "...",
      "scope": "global" | "room",
      "room_id": "uuid or null",
      "current_value": "...",
      "proposed_value": "...",
      "reasoning": "kurz, max 2 Sätze",
      "confidence": 0.0-1.0,
      "expected_outcome": { ... }
    }
  ],
  "summary": "1 Satz Gesamteinschätzung"
}`;

    // 3) Call Gemini (flash-lite for higher free-tier quota: 1000 RPD vs 20 RPD)
    const callGemini = async () => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 4096 },
        }),
      },
    );

    let geminiResp = await callGemini();

    // Retry once on 429/503 with backoff
    if (!geminiResp.ok && (geminiResp.status === 429 || geminiResp.status === 503)) {
      const retryAfterTxt = await geminiResp.text();
      console.warn('[ai-parameter-advisor] Gemini', geminiResp.status, '— retry in 30s');
      await new Promise((r) => setTimeout(r, 30000));
      geminiResp = await callGemini();
      if (!geminiResp.ok) {
        const txt = await geminiResp.text();
        console.error('[ai-parameter-advisor] Gemini retry failed', geminiResp.status, txt);
        return new Response(JSON.stringify({
          ok: true,
          rate_limited: true,
          error: `gemini_${geminiResp.status}`,
          message: geminiResp.status === 429
            ? 'Gemini-Tageslimit erreicht — Autopilot bleibt mit den bestehenden Regeln aktiv.'
            : 'Gemini ist gerade überlastet — Autopilot bleibt mit den bestehenden Regeln aktiv.',
          proposed: 0,
          accepted: 0,
          rejected: 0,
          auto_applied: 0,
          retry_after_seconds: 60,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (!geminiResp.ok) {
      const txt = await geminiResp.text();
      console.error('[ai-parameter-advisor] Gemini error', geminiResp.status, txt);
      return new Response(JSON.stringify({
        ok: false,
        error: `gemini_${geminiResp.status}`,
        message: `Gemini-Fehler ${geminiResp.status}`,
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const geminiJson = await geminiResp.json();
    const txt: string = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(txt);
    } catch {
      console.error('[ai-parameter-advisor] JSON parse failed', txt.slice(0, 500));
      return new Response(JSON.stringify({ ok: false, error: 'parse_failed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];

    // 4) Validate against whitelist + persist + auto-apply
    const wlMap = new Map(wl.map((w) => [`${w.parameter_key}|${w.scope}`, w]));
    const inserts: any[] = [];
    const rejected: any[] = [];
    const autoApplied: any[] = [];

    for (const d of decisions) {
      const w = wlMap.get(`${d.parameter_key}|${d.scope}`);
      if (!w) { rejected.push({ d, reason: 'not_in_whitelist' }); continue; }

      // Range / allowed_values check
      if (w.data_type === 'number' || w.data_type === 'integer') {
        const n = Number(d.proposed_value);
        if (!Number.isFinite(n)) { rejected.push({ d, reason: 'not_a_number' }); continue; }
        if (w.min_value !== null && n < Number(w.min_value)) { rejected.push({ d, reason: 'below_min' }); continue; }
        if (w.max_value !== null && n > Number(w.max_value)) { rejected.push({ d, reason: 'above_max' }); continue; }
      }
      if (Array.isArray(w.allowed_values) && !w.allowed_values.map(String).includes(String(d.proposed_value))) {
        rejected.push({ d, reason: 'not_in_allowed_values' }); continue;
      }
      if (d.scope === 'room' && !d.room_id) { rejected.push({ d, reason: 'missing_room_id' }); continue; }

      const isAutoWhitelisted = w.autonomy_level === 'auto';
      const isAuto = isAutoWhitelisted && autopilotEnabled;
      const decisionMode = isAuto ? 'auto' : (isAutoWhitelisted ? 'shadow' : 'shadow');

      // Dedupe: skip if proposed == current
      if (d.current_value != null && String(d.current_value) === String(d.proposed_value)) {
        rejected.push({ d, reason: 'no_change' });
        continue;
      }

      // Rate-limit: max 1 auto-apply per parameter per hour
      if (isAuto) {
        const { data: recent } = await sb
          .from('ai_parameter_decisions')
          .select('id')
          .eq('parameter_key', d.parameter_key)
          .eq('auto_applied', true)
          .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .limit(1);
        if (recent && recent.length > 0) {
          rejected.push({ d, reason: 'rate_limited_1h' });
          continue;
        }
      }


      inserts.push({
        parameter_scope: d.scope,
        room_id: d.scope === 'room' ? d.room_id : null,
        parameter_key: d.parameter_key,
        current_value: d.current_value != null ? String(d.current_value) : null,
        proposed_value: String(d.proposed_value),
        reasoning: d.reasoning ?? null,
        confidence: typeof d.confidence === 'number' ? d.confidence : null,
        context_snapshot: { soc: energy?.battery_soc, pv: energy?.pv_power, grid: energy?.power_io, forecast_kwh: today?.expected_kwh, autonomy_level: w.autonomy_level },
        expected_outcome: d.expected_outcome ?? {},
        decision_mode: decisionMode,
        auto_applied: isAuto,
      });

      // Auto-Apply: direkt in heating_settings schreiben
      if (isAuto && w.storage_table === 'heating_settings') {
        try {
          let updateVal: any = d.proposed_value;
          if (w.data_type === 'integer' || w.data_type === 'number') {
            updateVal = Number(updateVal);
          }
          if (w.data_type === 'boolean') {
            updateVal = updateVal === true || updateVal === 'true' || updateVal === '1';
          }

          const { error: updErr } = await sb.from('heating_settings')
            .update({ [w.storage_column]: updateVal })
            .neq(w.storage_column, updateVal); // nur wenn sich Wert ändert

          if (updErr) {
            console.error('[ai-parameter-advisor] auto-apply failed for', d.parameter_key, updErr);
            rejected.push({ d, reason: 'auto_apply_failed: ' + updErr.message });
          } else {
            autoApplied.push({ parameter_key: d.parameter_key, value: updateVal });
            console.log(`[ai-parameter-advisor] AUTO-APPLIED ${d.parameter_key} = ${updateVal}`);
          }
        } catch (e: any) {
          console.error('[ai-parameter-advisor] auto-apply exception', e);
          rejected.push({ d, reason: 'auto_apply_exception: ' + e.message });
        }
      }
    }

    if (inserts.length > 0) {
      const { error: insErr } = await sb.from('ai_parameter_decisions').insert(inserts);
      if (insErr) {
        console.error('[ai-parameter-advisor] insert failed', insErr);
        return new Response(JSON.stringify({ ok: false, error: insErr.message }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        proposed: decisions.length,
        accepted: inserts.length,
        rejected: rejected.length,
        auto_applied: autoApplied.length,
        auto_applied_details: autoApplied,
        rejected_details: rejected,
        summary: parsed?.summary ?? null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[ai-parameter-advisor] fatal', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
