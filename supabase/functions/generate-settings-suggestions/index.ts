import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Lovable AI Gateway
interface AIRequestBody {
  messages: Array<{ role: string; content: string }>;
  tools?: unknown[];
  tool_choice?: unknown;
}

interface AIResponse {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
}

async function callAI(requestBody: AIRequestBody): Promise<AIResponse> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return { ok: false, status: 0, error: 'LOVABLE_API_KEY not configured' };
  }

  try {
    console.log('Calling Lovable AI Gateway for settings suggestions...');
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: requestBody.messages,
        tools: requestBody.tools,
        tool_choice: requestBody.tool_choice,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429) {
        console.error('❌ Rate limit exceeded');
        return { ok: false, status: 429, error: 'Rate limit exceeded' };
      }
      if (response.status === 402) {
        console.error('❌ Credits exhausted');
        return { ok: false, status: 402, error: 'AI-Credits erschöpft' };
      }
      console.error('AI Gateway error:', response.status, errorText);
      return { ok: false, status: response.status, error: errorText };
    }

    const data = await response.json();
    console.log('✅ AI Gateway response received');
    return { ok: true, status: 200, data };
  } catch (err) {
    console.error('AI Gateway exception:', err);
    return { ok: false, status: 0, error: String(err) };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Load all context in parallel
    const [settingsRes, roomsRes, forecastsRes, recentReadingsRes, consumerLogsRes, weatherRes, mlFeaturesRes] = await Promise.all([
      supabase.from('heating_settings').select('*').limit(1).single(),
      supabase.from('rooms').select('*').order('priority', { ascending: true }),
      supabase.from('pv_forecasts').select('*').gte('date', new Date().toISOString().split('T')[0]).order('date').limit(3),
      supabase.from('energy_readings').select('*').order('timestamp', { ascending: false }).limit(20),
      supabase.from('consumer_logs').select('*').order('start_time', { ascending: false }).limit(10),
      supabase.from('weather_data').select('*').order('timestamp', { ascending: false }).limit(1),
      supabase.from('room_ml_features').select('*').order('date', { ascending: false }).limit(20),
    ]);

    const settings = settingsRes.data;
    const rooms = roomsRes.data || [];
    const forecasts = forecastsRes.data || [];
    const readings = recentReadingsRes.data || [];
    const consumerLogs = consumerLogsRes.data || [];
    const weather = weatherRes.data?.[0] || null;
    const mlFeatures = mlFeaturesRes.data || [];

    if (!settings) {
      return new Response(JSON.stringify({ error: 'Keine Heizungseinstellungen gefunden' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build context for AI
    const currentReading = readings[0] || null;
    const avgPower = readings.length > 0 
      ? readings.reduce((s, r) => s + (r.pv_power || 0), 0) / readings.length 
      : 0;

    const roomSummary = rooms.map(r => {
      const features = mlFeatures.filter(f => f.room_id === r.id);
      const latestFeature = features[0] || null;
      return {
        name: r.name,
        current_temp: r.current_temp,
        target_temp: r.target_temp,
        comfort_temp: r.comfort_temp ?? settings.comfort_temp,
        eco_temp: r.eco_temp ?? settings.eco_temp,
        night_temp: r.night_temp ?? settings.night_temp,
        heating_power_w: r.calculated_power_w ?? r.heating_power_w ?? 800,
        is_heating: r.is_heating,
        automation_enabled: r.automation_enabled,
        pv_auto_enabled: r.pv_auto_enabled,
        orientation: r.orientation,
        has_solar_gain: r.has_solar_gain,
        solar_gain_factor: r.calculated_solar_gain_factor,
        heat_loss_rate: latestFeature?.heat_loss_rate_deg_per_hour,
        pv_heating_ratio: latestFeature?.pv_heating_ratio,
        grid_import_ratio: latestFeature?.grid_import_ratio,
      };
    });

    const contextText = `
## Aktuelle Systemdaten

### Energiedaten (letzte Messung)
- PV-Leistung: ${currentReading?.pv_power ?? 'unbekannt'} W
- Netzleistung (power_io): ${currentReading?.power_io ?? 'unbekannt'} W (positiv=Bezug, negativ=Einspeisung)
- Batterie-SOC: ${currentReading?.battery_soc ?? 'unbekannt'}%
- Verbrauch: ${currentReading?.consumption ?? 'unbekannt'} W
- Durchschnittliche PV-Leistung (letzte 20 Messungen): ${Math.round(avgPower)} W

### Wetter
- Temperatur: ${weather?.temperature_c ?? 'unbekannt'}°C
- Bewölkung: ${weather?.cloud_cover_percent ?? 'unbekannt'}%
- Strahlung direkt: ${weather?.direct_radiation_wm2 ?? 'unbekannt'} W/m²

### PV-Prognose
${forecasts.map(f => `- ${f.date}: ${f.expected_kwh} kWh erwartet`).join('\n')}

### Aktuelle Einstellungen
- Comfort-Temp: ${settings.comfort_temp}°C
- Eco-Temp: ${settings.eco_temp}°C
- Nacht-Temp: ${settings.night_temp}°C
- Min-Batterie-SOC: ${settings.min_battery_soc}%
- Ziel-Batterie-SOC: ${settings.target_battery_soc}%
- PV-Kapazität: ${settings.pv_capacity_kwp} kWp
- Batterie-Kapazität: ${settings.battery_capacity_kwh} kWh
- PV-Schwelle Ein: ${settings.pv_surplus_threshold_on ?? 'Standard'} W
- PV-Schwelle Aus: ${settings.pv_surplus_threshold_off ?? 'Standard'} W
- Nachtmodus: ${settings.night_heating_mode ?? 'Standard'}
- Nacht-Start: ${settings.night_start_time ?? '22:00'}
- Nacht-Ende: ${settings.night_end_time ?? '06:00'}
- Nacht-Zyklen aktiviert: ${settings.night_cycling_enabled ?? false}
- Zyklen pro Raum/Nacht: ${settings.avg_night_cycles_per_room ?? 2}
- Warmwasser aktiv: ${settings.hotwater_enabled ?? false}
- WW-Zeitfenster: ${settings.hotwater_schedule_start ?? '10:00'} - ${settings.hotwater_schedule_end ?? '15:00'}
- WW-Min-Überschuss: ${settings.hotwater_min_surplus_w ?? 1500} W
- Strompreis: ${settings.electricity_price_kwh_cent ?? 20.28} ct/kWh
- Einspeisevergütung: ${settings.feed_in_price_kwh_cent ?? 8.0} ct/kWh
- Power-Budget aktiviert: ${settings.power_budget_enabled ?? false}
- Budget-Toleranz: ${settings.power_budget_tolerance_w ?? 200} W
- Estrichspeicher: ${settings.estrich_storage_enabled ?? false}

### Räume
${roomSummary.map(r => `- ${r.name}: Ist=${r.current_temp}°C, Soll=${r.target_temp}°C, Comfort=${r.comfort_temp}°C, Eco=${r.eco_temp}°C, Nacht=${r.night_temp}°C, Heizleistung=${r.heating_power_w}W, Heizt=${r.is_heating ? 'Ja' : 'Nein'}, Auto=${r.automation_enabled ? 'An' : 'Aus'}, PV-Auto=${r.pv_auto_enabled ? 'An' : 'Aus'}, Orientierung=${r.orientation ?? 'unbekannt'}, Solargewinn-Faktor=${r.solar_gain_factor ?? 'unbekannt'}, Wärmeverlust=${r.heat_loss_rate ?? 'unbekannt'}°C/h, PV-Heizanteil=${r.pv_heating_ratio != null ? Math.round(r.pv_heating_ratio * 100) + '%' : 'unbekannt'}, Netzbezug-Anteil=${r.grid_import_ratio != null ? Math.round(r.grid_import_ratio * 100) + '%' : 'unbekannt'}`).join('\n')}

### Verbraucher (letzte Einträge)
${consumerLogs.slice(0, 5).map(c => `- ${c.consumer_type}: ${c.is_active ? 'AKTIV' : 'beendet'}, ${c.avg_power_w}W avg`).join('\n') || 'Keine Daten'}
`;

    const systemPrompt = `Du bist ein Energieoptimierungs-Experte für ein smartes Heizsystem mit PV-Anlage und Batterie.

Deine Aufgabe: Analysiere die aktuellen Systemdaten und schlage konkrete Einstellungsänderungen vor, die:
1. Den Eigenverbrauch der PV-Anlage maximieren
2. Den Netzbezug für Heizung minimieren
3. Die Batterie optimal nutzen
4. Den Komfort erhalten

Die Heizung nutzt eine 4-Stufen PV-Logik:
- Stufe 1: Raum < eco_temp → eco heizen (wenn gridExport >= heatingPower)
- Stufe 2: eco erreicht, Batterie ≥ 95%, kein WW → comfort heizen
- Stufe 3: ALLE Räume ≥ comfort, Export reicht → Super-Comfort (+1°C)
- Stufe 4: Sonst → halten

Wichtige Regeln:
- Schlage NUR Änderungen vor, die auch wirklich sinnvoll sind basierend auf den Daten
- Begründe jede Empfehlung mit konkreten Zahlen aus den Daten
- Wenn alles optimal eingestellt ist, sage das auch
- Berücksichtige Jahreszeit, Wetter und PV-Prognose
- Berücksichtige die ML-Features (Wärmeverlustrate, PV-Heizanteil) wenn verfügbar
- Antworte auf Deutsch`;

    const tools = [{
      type: "function",
      function: {
        name: "suggest_settings",
        description: "Gibt strukturierte Einstellungsvorschläge zurück",
        parameters: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { 
                    type: "string", 
                    enum: ["hotwater", "night_cycling", "global_temps", "pv_thresholds", "room_temp", "battery", "automation"] 
                  },
                  setting_key: { type: "string", description: "Der Einstellungsschlüssel z.B. comfort_temp, night_temp, hotwater_schedule_start" },
                  room_name: { type: "string", description: "Raumname, nur bei category=room_temp" },
                  current_value: { type: "string", description: "Aktueller Wert als String" },
                  suggested_value: { type: "string", description: "Vorgeschlagener neuer Wert als String" },
                  reason: { type: "string", description: "Begründung auf Deutsch mit konkreten Zahlen" },
                  priority: { type: "string", enum: ["high", "medium", "low"] }
                },
                required: ["category", "setting_key", "current_value", "suggested_value", "reason", "priority"]
              }
            },
            overall_analysis: { type: "string", description: "Zusammenfassende Analyse auf Deutsch" }
          },
          required: ["suggestions", "overall_analysis"]
        }
      }
    }];

    const aiResponse = await callGoogleAI({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextText }
      ],
      tools,
      tool_choice: { type: "function", function: { name: "suggest_settings" } }
    });

    if (!aiResponse.ok) {
      console.error('AI call failed:', aiResponse.error);
      return new Response(JSON.stringify({ error: 'KI-Analyse fehlgeschlagen', details: aiResponse.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract tool call result
    const message = aiResponse.data?.choices?.[0]?.message;
    let suggestions: any[] = [];
    let overallAnalysis = '';

    if (message?.tool_calls?.[0]?.function?.arguments) {
      try {
        const args = JSON.parse(message.tool_calls[0].function.arguments);
        suggestions = args.suggestions || [];
        overallAnalysis = args.overall_analysis || '';
      } catch (e) {
        console.error('Failed to parse tool call arguments:', e);
      }
    } else if (message?.content) {
      overallAnalysis = message.content;
    }

    return new Response(JSON.stringify({ suggestions, overall_analysis: overallAnalysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
