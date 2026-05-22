import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient }  from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_KEY  = Deno.env.get('ANTHROPIC_API_KEY')!;
const GEMINI_KEY     = Deno.env.get('GOOGLE_AI_API_KEY')!;

interface ClaudeToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ClaudeContent {
  type: string;
  text?: string;
  tool_use?: ClaudeToolUse;
}

interface ClaudeMessage {
  role: 'assistant' | 'user';
  content: ClaudeContent[];
}

// ================================================================
// Anthropic API Helpers
// ================================================================
async function callClaudeHaiku(prompt: string, toolName: string, toolSchema: object): Promise<any> {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 4096,
      temperature: 1,
      messages: [{ role: 'user', content: prompt }],
      tools: [{
        name: toolName,
        description: 'Erstelle einen strukturierten Heizplan für den Tag',
        input_schema: toolSchema,
      }],
      tool_choice: { type: 'tool', name: toolName },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const toolUse = json.content?.find((c: any) => c.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return tool_use');
  return toolUse.input;
}

// Gemini-Fallback (identisch zu ai-parameter-advisor Pattern)
async function callGeminiFallback(prompt: string): Promise<any> {
  if (!GEMINI_KEY) throw new Error('GOOGLE_AI_API_KEY not configured');

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt}`);
  }

  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(raw);
}

// ================================================================
// Helpers
// ================================================================
function getTodayVienna(): string {
  const d = new Date();
  const v = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
  return v.toISOString().slice(1,10);
}

function buildToolSchema() {
  return {
    type: 'object' as const,
    properties: {
      plan_date: { type: 'string', description: 'Datum im Format YYYY-MM-DD' },
      overall_strategy: { type: 'string', description: 'Klartext-Strategie für den Tag (max 200 Wörter)' },
      rooms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            room_id:   { type: 'string' },
            room_name: { type: 'string' },
            priority_rank: { type: 'integer', description: '1 = höchste Priorität (heißt: bekommt als Erster Überschuss)' },
            recommended_temp: { type: 'number', description: 'Empfohlene Zieltemperatur für den Tag' },
            reasoning: { type: 'string', description: 'Begründung in 1-2 Sätzen' },
          },
          required: ['room_id','room_name','priority_rank','recommended_temp','reasoning'],
        },
      },
      time_blocks: {
        type: 'array',
        description: 'Optimal: Zeitblöcke mit unterschiedlicher Strategie',
        items: {
          type: 'object',
          properties: {
            start_time: { type: 'string', description: 'HH:MM' },
            end_time:   { type: 'string', description: 'HH:MM' },
            strategy:   { type: 'string', description: 'z.B. "Eco-Heizung", "Komfort-Phase", "Solar-Push"' },
          },
          required: ['start_time','end_time','strategy'],
        },
      },
    },
    required: ['plan_date','overall_strategy','rooms'],
  };
}

// ================================================================
// Main Handler
// ================================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const today = getTodayVienna();

  try {
    // ── 1) Daten sammeln ──────────────────────────────────────
    const [
      { data: forecasts },
      { data: rooms },
      { data: mlFeatures },
      { data: weatherNext },
      { data: scores7d },
      { data: lastPlans },
      { data: settingsRow },
    ] = await Promise.all([
      sb.from('pv_forecasts')
        .select('date,expected_kwh,hourly_watts,sunrise,sunset')
        .gte('date', today)
        .order('date')
        .limit(2),
      sb.from('rooms')
        .select('id,name,current_temp,target_temp,is_heating,eco_temp,comfort_temp,night_temp,priority,automation_enabled,floor_area_m2,orientation')
        .order('priority', { ascending: true }),
      sb.from('room_ml_features')
        .select('room_id,energy_per_degree,heat_loss_rate,heating_rate_deg_per_hour,confidence,date')
        .order('date', { ascending: false })
        .limit(12),
      sb.from('weather_data')
        .select('timestamp,temperature_c,cloud_cover_percent,wind_speed_kmh')
        .gte('timestamp', new Date(Date.now() - 24*60*60*1000).toISOString())
        .order('timestamp', { ascending: false })
        .limit(24),
      sb.from('daily_pattern_scores')
        .select('date,score,kpi_self_consumption_ratio,kpi_pv_heating_coverage,settings_snapshot')
        .order('date', { ascending: false })
        .limit(7),
      sb.from('heating_recommendations')
        .select('valid_for_date,reasoning,priority_rank,ai_source')
        .eq('ai_source','daily_planner')
        .order('valid_for_date', { ascending: false })
        .limit(5),
      sb.from('heating_settings')
        .select('*')
        .limit(1)
        .maybeSingle(),
    ]);

    const settings = settingsRow ?? {};
    const todayForecast = forecasts?.[0] ?? null;
    const tomorrowForecast = forecasts?.[1] ?? null;

    // ── 2) Prompt bauen ──────────────────────────────────────
    const prompt = `Du bist ein erfahrener Energie-Optimierer für ein PV-Heizsystem in Österreich.

HARDWARE:
- 15.8 kWp PV-Anlage, 35° Neigung, Südausrichtung
- 13.8 kWh Batterie (autonom via Smartfox)
- 12 Räume mit Tuya TGP508-Thermostaten (Lokal-Steuerung, Port 6668)
- Fronius Wechselrichter liefert Live-Daten

WICHTIGE REGELN:
1. Nachtmodus (22:00–06:00): "frost_only" oder "maintain" — KEIN Komfort-Heizen
2. Tagstart folgt settings.night_end_time (Default 08:00)
3. Smartfox steuert die Batterie autonom — heating_min_battery_soc ist ein Floor (keine Lade-Cap)
4. Warmwasser ist autonom via Smartfox
5. Die KI-Parameter-Autonomie ist aktiv — du schreibst Vorschläge, aber der pv-automation Edge Function ist die alleinige Setpoint-Autorität

DATEN FÜR HEUTE (${today}):

PV-PROGNOSE:
Heute: ${JSON.stringify(todayForecast)}
Morgen: ${JSON.stringify(tomorrowForecast)}

RÄUME (${(rooms ?? []).length}):
${JSON.stringify(rooms ?? [])}

ML-EFFIZIENZ (room_ml_features):
${JSON.stringify(mlFeatures ?? [])}

WETTER (nächste 24h):
${JSON.stringify(weatherNext ?? [])}

LETZTE 7 TAGE SCORES:
${JSON.stringify(scores7d ?? [])}

LETZTE TAGESPLÄNE (zum Lernen):
${JSON.stringify(lastPlans ?? [])}

HEATING_SETTINGS:
${JSON.stringify(settings)}

AUFGABE:
Erstelle einen Tagesplan für HEUTE mit:
- priority_rank: Welcher Raum bekommt zuerst Überschuss? (1 = höchste Priorität)
- recommended_temp: Welche Zieltemperatur empfohlen?
- reasoning: Warum?
- overall_strategy: Kurze Klartext-Strategie (max 200 Wörter)
- time_blocks: Wenn sinnvoll, Blöcke mit unterschiedlicher Strategie (z.B. morgens Eco, mittags Solar-Push)

Nutze TOOL-USE mit dem bereitgestellten Schema.`;

    // ── 3) Claude Haiku aufrufen ──────────────────────────────
    let plan: any;
    let source = 'claude-haiku';
    let errorDetails = null;

    try {
      plan = await callClaudeHaiku(prompt, 'create_daily_heating_plan', buildToolSchema());
    } catch (e: any) {
      console.warn('Claude failed, falling back to Gemini:', e.message);
      errorDetails = e.message;
      try {
        plan = await callGeminiFallback(prompt + '\n\nAntworte NUR mit validem JSON nach diesem Schema: ' + JSON.stringify(buildToolSchema()));
        source = 'gemini-flash-fallback';
      } catch (e2: any) {
        return new Response(
          JSON.stringify({ ok: false, error: 'both_ai_failed', details: { claude: errorDetails, gemini: e2.message } }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ── 4) Validierung ─────────────────────────────────────────
    if (!plan || !Array.isArray(plan.rooms) || plan.rooms.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: 'invalid_plan', details: plan }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 5) In DB schreiben (ai_daily_plans, 1 Zeile pro Tag) ──
    const { error: upsertErr } = await sb
      .from('ai_daily_plans')
      .upsert({
        plan_date: today,
        source,
        overall_strategy: plan.overall_strategy ?? null,
        time_blocks: plan.time_blocks ?? [],
        rooms: plan.rooms ?? [],
        raw_plan: plan,
      }, { onConflict: 'plan_date' });

    if (upsertErr) throw upsertErr;


    return new Response(
      JSON.stringify({
        ok: true,
        source,
        plan_date: today,
        room_count: inserts.length,
        overall_strategy: plan.overall_strategy,
        fallback_error: errorDetails,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e: any) {
    console.error('ai-daily-planner error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
