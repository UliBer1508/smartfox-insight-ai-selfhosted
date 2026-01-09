import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      readings, 
      heatingSettings, 
      rooms, 
      consumerLogs, 
      type,
      mlFeatures,
      weatherData,
      recentRewards
    } = await req.json();
    
    console.log(`Analyzing type: ${type}, readings: ${readings?.length || 0}, rooms: ${rooms?.length || 0}`);
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    let prompt = '';
    let useToolCalling = false;
    let toolName = '';
    let toolDefinition: Record<string, unknown> | null = null;
    
    // NEW: ML-based optimize_decision type
    if (type === 'optimize_decision') {
      useToolCalling = true;
      toolName = 'make_heating_decision';
      
      const currentReading = readings?.[0];
      const surplus = currentReading?.power_io ? -currentReading.power_io : 0;
      const batterySoc = currentReading?.battery_soc || 50;
      const pvPower = currentReading?.pv_power || 0;
      const consumption = currentReading?.consumption || 0;
      
      const now = new Date();
      const hour = now.getHours();
      const isNight = hour < 6 || hour >= 22;
      const isMorning = hour >= 6 && hour < 10;
      const isPeakSolar = hour >= 10 && hour < 16;
      
      prompt = `Du bist ein ML-basiertes Heizungsoptimierungssystem. Dein Ziel ist es, Energie zu sparen und Komfort zu gewährleisten.

**ZEITPUNKT:** ${now.toLocaleString('de-DE')} (${isNight ? 'Nacht' : isMorning ? 'Morgen' : isPeakSolar ? 'Hauptsonnenzeit' : 'Nachmittag/Abend'})

**ENERGIESITUATION:**
- PV-Überschuss: ${surplus}W ${surplus > 500 ? '✅ gut' : surplus > 0 ? '➖ gering' : '❌ Netzbezug'}
- Batterie-SOC: ${batterySoc}% ${batterySoc > 80 ? '✅' : batterySoc > 50 ? '➖' : batterySoc > 20 ? '⚠️' : '❌'}
- PV-Leistung: ${pvPower}W
- Verbrauch: ${consumption}W

**WETTER:**
${weatherData ? `- Außentemp: ${weatherData.temperature_c}°C, Bewölkung: ${weatherData.cloud_cover_percent}%, Strahlung: ${weatherData.direct_radiation_wm2 || 0}W/m²` : '- Keine Wetterdaten'}

**EINSTELLUNGEN:**
- Komfort: ${heatingSettings?.comfort_temp || 21}°C, Eco: ${heatingSettings?.eco_temp || 18}°C, Nacht: ${heatingSettings?.night_temp || 16}°C
- Min. SOC: ${heatingSettings?.min_battery_soc || 20}%, PV-Schwelle EIN: ${heatingSettings?.pv_surplus_threshold_on || 500}W, AUS: ${heatingSettings?.pv_surplus_threshold_off || 200}W

**RÄUME MIT ML-FEATURES:**
${rooms?.map((r: Record<string, unknown>) => {
  const f = mlFeatures?.find((mf: Record<string, unknown>) => mf.room_id === r.id);
  return `📍 ${r.name} (${r.id}): ${r.current_temp || '?'}°C→${r.target_temp || '?'}°C | PV-Auto: ${r.pv_auto_active ? '🔥' : '❄️'} | Power: ${r.heating_power_w || r.calculated_power_w || 1000}W
   ${f ? `ML: HeatLoss ${(f.heat_loss_rate_deg_per_hour as number)?.toFixed(2) || '?'}°/h, HeatingRate ${(f.heating_rate_deg_per_hour as number)?.toFixed(2) || '?'}°/h, PV-Anteil ${(((f.pv_heating_ratio as number) || 0) * 100).toFixed(0)}%, Confidence ${(((f.confidence as number) || 0) * 100).toFixed(0)}%` : '⚠️ Keine ML-Features'}`;
}).join('\n') || 'Keine Räume'}

**FEEDBACK (letzte Entscheidungen):**
${recentRewards?.length > 0 ? recentRewards.slice(0, 5).map((r: Record<string, unknown>) => {
  const reward = r.reward as number | null;
  return `${reward === null ? '⏳' : reward > 0.5 ? '✅' : reward > 0 ? '➖' : '❌'} ${r.decision_type}: Reward ${reward?.toFixed(2) || 'pending'}`;
}).join('\n') : '⏳ Noch keine Daten'}

**REGELN:**
1. PV-Überschuss >${heatingSettings?.pv_surplus_threshold_on || 500}W → Heizung aktivieren erwägen
2. PV-Überschuss <${heatingSettings?.pv_surplus_threshold_off || 200}W → Heizung deaktivieren erwägen
3. Batterie <${heatingSettings?.min_battery_soc || 20}% → Keine Aktivierung
4. Nachts nur bei voller Batterie
5. Räume mit hohem PV-Anteil bevorzugen
6. Bei niedriger Confidence vorsichtiger

Gib für jeden Raum mit pv_auto_enabled=true eine Entscheidung.`;

      toolDefinition = {
        type: "function",
        function: {
          name: "make_heating_decision",
          description: "ML-basierte Heizungsentscheidungen",
          parameters: {
            type: "object",
            properties: {
              decisions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    room_id: { type: "string" },
                    room_name: { type: "string" },
                    action: { type: "string", enum: ["activate", "deactivate", "keep"] },
                    target_temp: { type: "number" },
                    reasoning: { type: "string" },
                    expected_energy_wh: { type: "number" },
                    confidence: { type: "number" }
                  },
                  required: ["room_id", "room_name", "action", "target_temp", "reasoning"]
                }
              },
              overall_strategy: { type: "string" },
              expected_total_savings_wh: { type: "number" }
            },
            required: ["decisions", "overall_strategy"]
          }
        }
      };

    } else if (type === 'room_heating_optimization' && rooms && rooms.length > 0) {
      useToolCalling = true;
      toolName = 'create_room_heating_plan';
      
      // Calculate averages from readings
      const avgPower = readings.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.power_io as number) || 0), 0) / readings.length;
      const avgSoc = readings.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.battery_soc as number) || 50), 0) / readings.length;
      const maxPvPower = Math.max(...readings.map((r: Record<string, unknown>) => (r.pv_power as number) || 0));
      const currentPvPower = readings[readings.length - 1]?.pv_power || 0;
      
      // Extract time patterns
      const hourlyData: Record<number, number[]> = {};
      readings.forEach((r: Record<string, unknown>) => {
        const hour = new Date(r.timestamp as string).getHours();
        if (!hourlyData[hour]) hourlyData[hour] = [];
        hourlyData[hour].push((r.power_io as number) || 0);
      });
      
      const hourlyAvg = Object.entries(hourlyData).map(([hour, values]) => ({
        hour: parseInt(hour),
        avgPower: values.reduce((a, b) => a + b, 0) / values.length
      })).sort((a, b) => a.hour - b.hour);

      const roomsList = rooms.map((r: Record<string, unknown>) => 
        `- ${r.name}: ${r.orientation || 'keine Ausrichtung'}, ${r.floor_area_m2 || '?'}m², ` +
        `Heizleistung: ${r.heating_power_w || 800}W, ` +
        `Sonneneinstrahlung: ${r.has_solar_gain ? 'Ja' : 'Nein'}, ` +
        `Priorität: ${r.priority}, Komfort: ${r.comfort_temp}°C, Eco: ${r.eco_temp}°C, Nacht: ${r.night_temp}°C`
      ).join('\n');

      // Heizungstyp-Information
      const heatingType = heatingSettings?.heating_type || 'direct_electric';
      const totalInstalledPower = heatingSettings?.total_heating_power_w || 
        rooms.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.heating_power_w as number) || 800), 0);

      const heatingTypeInfo = heatingType === 'direct_electric' ? `
**Heizungstyp: Direkte elektrische Fußbodenheizung**
- Gesamtleistung: ${totalInstalledPower}W
- Thermostate: TGP508 WiFi
` : '';

      // Hotwater config
      const hotwaterEnabled = heatingSettings?.hotwater_enabled !== false;
      const hotwaterPower = heatingSettings?.hotwater_power_w || 2800;
      const hotwaterStart = heatingSettings?.hotwater_schedule_start || '10:00';
      const hotwaterEnd = heatingSettings?.hotwater_schedule_end || '16:00';

      const hotwaterInfo = hotwaterEnabled ? `
**Warmwasser:** ${hotwaterPower}W, ${hotwaterStart}-${hotwaterEnd}
` : '';

      prompt = `Erstelle RAUMSPEZIFISCHE Heizempfehlungen:
${heatingTypeInfo}
**Anlage:** PV ${heatingSettings?.pv_capacity_kwp || 15.8}kWp, Batterie ${heatingSettings?.battery_capacity_kwh || 13.8}kWh, SOC ${avgSoc.toFixed(0)}%
**Energie:** PV aktuell ${currentPvPower}W, Max ${maxPvPower}W, Durchschnitt ${avgPower.toFixed(0)}W

**Stündlich:** ${hourlyAvg.map(h => `${h.hour}h: ${h.avgPower.toFixed(0)}W`).join(', ')}
${hotwaterInfo}
**Räume:**
${roomsList}

**Uhrzeit:** ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}

Erstelle für JEDEN Raum eine Empfehlung.`;

      toolDefinition = {
        type: "function",
        function: {
          name: "create_room_heating_plan",
          description: "Erstellt raumspezifische Heizempfehlungen",
          parameters: {
            type: "object",
            properties: {
              rooms: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    room_name: { type: "string" },
                    recommended_temp: { type: "number" },
                    priority: { type: "string", enum: ["heat_now", "preheat", "hold", "reduce", "off"] },
                    reason: { type: "string" },
                    periods: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          start_time: { type: "string" },
                          end_time: { type: "string" },
                          temperature: { type: "number" }
                        },
                        required: ["start_time", "end_time", "temperature"]
                      }
                    }
                  },
                  required: ["room_name", "recommended_temp", "priority", "reason", "periods"]
                }
              },
              strategy: { type: "string" },
              next_change: { type: "string" }
            },
            required: ["rooms", "strategy", "next_change"]
          }
        }
      };

    } else if (type === 'heating_optimization') {
      useToolCalling = true;
      toolName = 'create_heating_plan';
      
      const avgPower = readings.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.power_io as number) || 0), 0) / readings.length;
      const avgSoc = readings.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.battery_soc as number) || 50), 0) / readings.length;
      const maxPvPower = Math.max(...readings.map((r: Record<string, unknown>) => (r.pv_power as number) || 0));
      
      const hourlyData: Record<number, number[]> = {};
      readings.forEach((r: Record<string, unknown>) => {
        const hour = new Date(r.timestamp as string).getHours();
        if (!hourlyData[hour]) hourlyData[hour] = [];
        hourlyData[hour].push((r.power_io as number) || 0);
      });
      
      const hourlyAvg = Object.entries(hourlyData).map(([hour, values]) => ({
        hour: parseInt(hour),
        avgPower: values.reduce((a, b) => a + b, 0) / values.length
      })).sort((a, b) => a.hour - b.hour);

      prompt = `Erstelle optimalen 6-Perioden-Heizplan für TGP508:

**Anlage:** PV ${heatingSettings?.pv_capacity_kwp || 15.8}kWp, Batterie ${heatingSettings?.battery_capacity_kwh || 13.8}kWh
**Temps:** Komfort ${heatingSettings?.comfort_temp || 21}°C, Eco ${heatingSettings?.eco_temp || 19}°C, Nacht ${heatingSettings?.night_temp || 18}°C
**Energie:** Durchschnitt ${avgPower.toFixed(0)}W, SOC ${avgSoc.toFixed(0)}%, Max PV ${maxPvPower}W

**Stündlich:** ${hourlyAvg.map(h => `${h.hour}h: ${h.avgPower.toFixed(0)}W`).join(', ')}`;

      toolDefinition = {
        type: "function",
        function: {
          name: "create_heating_plan",
          description: "Erstellt 6-Perioden-Heizplan für TGP508",
          parameters: {
            type: "object",
            properties: {
              periods: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    period: { type: "number" },
                    startTime: { type: "string" },
                    endTime: { type: "string" },
                    temperature: { type: "number" },
                    reason: { type: "string" },
                    icon: { type: "string", enum: ["sun", "battery", "moon", "thermometer"] }
                  },
                  required: ["period", "startTime", "endTime", "temperature", "reason", "icon"]
                }
              },
              summary: { type: "string" },
              expectedPvSurplus: { type: "number" },
              batteryStrategy: { type: "string" },
              recommendations: { type: "array", items: { type: "string" } }
            },
            required: ["periods", "summary", "expectedPvSurplus", "batteryStrategy", "recommendations"]
          }
        }
      };

    } else if (type === 'daily_pattern') {
      const totalHeatingPower = rooms?.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.heating_power_w as number) || 800), 0) || 0;
      const roomsList = rooms?.map((r: Record<string, unknown>) => `${r.name} (${r.heating_power_w || 800}W)`).join(', ') || 'Keine Räume';
      
      let consumerActivity = '';
      if (consumerLogs && consumerLogs.length > 0) {
        consumerActivity = '\n**VERBRAUCHER:**\n';
        consumerLogs.forEach((log: Record<string, unknown>) => {
          const start = new Date(log.start_time as string).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
          const end = log.end_time ? new Date(log.end_time as string).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'aktiv';
          consumerActivity += `- ${log.consumer_type}: ${start}-${end}, ~${Math.round((log.avg_power_w as number) || 0)}W\n`;
        });
      }

      prompt = `Analysiere Tagesenergieprofil:

**Bekannte Verbraucher:** Heizung ${totalHeatingPower}W (${roomsList}), Warmwasser ${heatingSettings?.hotwater_power_w || 6000}W
${consumerActivity}
**Daten:**
${readings.map((r: Record<string, unknown>) => `${r.timestamp}: ${r.power_io}W, PV: ${r.pv_power || 0}W, SOC: ${r.battery_soc || 0}%`).join('\n')}

Ordne Spitzen den bekannten Verbrauchern zu. Antworte auf Deutsch.`;

    } else if (type === 'weekly_comparison') {
      const totalHeatingPower = rooms?.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.heating_power_w as number) || 800), 0) || 0;

      prompt = `Wochenvergleich:

**Verbraucher:** Heizung ${totalHeatingPower}W, Warmwasser ${heatingSettings?.hotwater_power_w || 6000}W

**Daten:**
${readings.map((r: Record<string, unknown>) => `${r.date}: Peak ${r.peak_power}W, Avg ${r.avg_power}W, Import ${r.total_energy_in}kWh, Export ${r.total_energy_out}kWh`).join('\n')}

Analysiere Trends und gib Empfehlungen. Deutsch.`;

    } else {
      prompt = `Aktueller Energiestatus:
Leistung: ${readings?.power_io}W, Import: ${readings?.energy_in}kWh, Export: ${readings?.energy_out}kWh
Kurze Einschätzung auf Deutsch.`;
    }

    const requestBody: Record<string, unknown> = {
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'Du bist ein Experte für Energiemanagement und Heizungsoptimierung. Antworte auf Deutsch.' },
        { role: 'user', content: prompt }
      ],
    };

    if (useToolCalling && toolDefinition) {
      requestBody.tools = [toolDefinition];
      requestBody.tool_choice = { type: "function", function: { name: toolName } };
    }

    console.log('Calling AI Gateway...');
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit', decisions: [] }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    console.log('AI response received');

    // Handle tool calling response
    if (useToolCalling && data.choices?.[0]?.message?.tool_calls) {
      const toolCall = data.choices[0].message.tool_calls[0];
      if (toolCall?.function?.name === toolName) {
        try {
          const result = JSON.parse(toolCall.function.arguments);
          console.log(`${toolName} parsed successfully`);
          
          if (toolName === 'make_heating_decision') {
            return new Response(JSON.stringify(result), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          } else if (toolName === 'create_room_heating_plan') {
            return new Response(JSON.stringify({ roomHeatingPlan: result }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          } else {
            return new Response(JSON.stringify({ heatingPlan: result }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch (parseError) {
          console.error('Error parsing result:', parseError);
        }
      }
    }

    const analysis = data.choices?.[0]?.message?.content || 'Keine Analyse verfügbar.';
    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-patterns:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unbekannter Fehler',
      decisions: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
