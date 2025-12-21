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
    const { readings, heatingSettings, rooms, type } = await req.json();
    
    console.log(`Analyzing type: ${type}, readings: ${readings?.length || 0}, rooms: ${rooms?.length || 0}`);
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    let prompt = '';
    let useToolCalling = false;
    let toolName = '';
    let toolDefinition: any = null;
    
    if (type === 'room_heating_optimization' && rooms && rooms.length > 0) {
      useToolCalling = true;
      toolName = 'create_room_heating_plan';
      
      // Calculate averages from readings
      const avgPower = readings.reduce((sum: number, r: any) => sum + (r.power_io || 0), 0) / readings.length;
      const avgSoc = readings.reduce((sum: number, r: any) => sum + (r.battery_soc || 50), 0) / readings.length;
      const maxPvPower = Math.max(...readings.map((r: any) => r.pv_power || 0));
      const currentPvPower = readings[readings.length - 1]?.pv_power || 0;
      
      // Extract time patterns
      const hourlyData: Record<number, number[]> = {};
      readings.forEach((r: any) => {
        const hour = new Date(r.timestamp).getHours();
        if (!hourlyData[hour]) hourlyData[hour] = [];
        hourlyData[hour].push(r.power_io || 0);
      });
      
      const hourlyAvg = Object.entries(hourlyData).map(([hour, values]) => ({
        hour: parseInt(hour),
        avgPower: values.reduce((a, b) => a + b, 0) / values.length
      })).sort((a, b) => a.hour - b.hour);

      const roomsList = rooms.map((r: any) => 
        `- ${r.name}: ${r.orientation || 'keine Ausrichtung'}, ${r.floor_area_m2 || '?'}m², ` +
        `Sonneneinstrahlung: ${r.has_solar_gain ? 'Ja' : 'Nein'}, ` +
        `Priorität: ${r.priority}, Komfort: ${r.comfort_temp}°C, Eco: ${r.eco_temp}°C, Nacht: ${r.night_temp}°C`
      ).join('\n');

      prompt = `Du bist ein Experte für Energiemanagement und Fußbodenheizung mit PV und Batterie.

Erstelle RAUMSPEZIFISCHE Heizempfehlungen für jeden Raum basierend auf:

**Anlagen-Konfiguration:**
- PV-Kapazität: ${heatingSettings?.pv_capacity_kwp || 15.8} kWp
- Batterie-Kapazität: ${heatingSettings?.battery_capacity_kwh || 13.8} kWh
- Aktueller Batterie-SOC: ${avgSoc.toFixed(0)}%
- Ziel-SOC: ${heatingSettings?.target_battery_soc || 80}%
- Min-SOC Reserve: ${heatingSettings?.min_battery_soc || 20}%

**Aktuelle Energiedaten:**
- Aktuelle PV-Leistung: ${currentPvPower.toFixed(0)}W
- Durchschnittliche Leistung: ${avgPower.toFixed(0)}W
- Max. PV-Leistung gemessen: ${maxPvPower.toFixed(0)}W

**Stündliche Durchschnittsleistung (W, negativ = Einspeisung):**
${hourlyAvg.map(h => `${h.hour}:00 Uhr: ${h.avgPower.toFixed(0)}W`).join('\n')}

**Räume im Haushalt:**
${roomsList}

**Optimierungsregeln:**
1. **Südräume mit Sonneneinstrahlung zuerst heizen** bei PV-Überschuss - kostenlose Solarwärme + PV-Strom
2. **Nordzimmer verzögern** bis Batterie ausreichend geladen (>${heatingSettings?.target_battery_soc || 80}%)
3. **Priorität beachten**: Priorität 1 = wichtig (z.B. Wohnzimmer), Priorität 3 = weniger wichtig (z.B. Gästezimmer)
4. **Bei niedrigem SOC (<${heatingSettings?.min_battery_soc || 20}%)**: Nur Priorität 1 Räume heizen
5. **Estrich als Wärmespeicher**: Räume bei PV-Überschuss über Komfort-Temp aufheizen (max +2°C)
6. **Nachtabsenkung**: Alle Räume auf Nacht-Temp ab 22:00

**Aktuelle Uhrzeit:** ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}

Erstelle für JEDEN Raum eine aktuelle Empfehlung mit Zieltemperatur und Begründung.`;

      toolDefinition = {
        type: "function",
        function: {
          name: "create_room_heating_plan",
          description: "Erstellt raumspezifische Heizempfehlungen für alle Räume",
          parameters: {
            type: "object",
            properties: {
              rooms: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    room_name: { type: "string", description: "Name des Raums" },
                    recommended_temp: { type: "number", description: "Empfohlene Temperatur in °C" },
                    priority: { 
                      type: "string", 
                      enum: ["heat_now", "preheat", "hold", "reduce", "off"],
                      description: "Aktion: heat_now=jetzt heizen, preheat=vorheizen, hold=halten, reduce=reduzieren, off=aus"
                    },
                    reason: { type: "string", description: "Kurze Begründung (max 50 Zeichen)" },
                    periods: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          start_time: { type: "string", description: "Startzeit HH:MM" },
                          end_time: { type: "string", description: "Endzeit HH:MM" },
                          temperature: { type: "number" }
                        },
                        required: ["start_time", "end_time", "temperature"]
                      }
                    }
                  },
                  required: ["room_name", "recommended_temp", "priority", "reason", "periods"]
                }
              },
              strategy: { type: "string", description: "Gesamt-Strategie Erklärung (1 Satz)" },
              next_change: { type: "string", description: "Wann ist die nächste Änderung geplant?" }
            },
            required: ["rooms", "strategy", "next_change"]
          }
        }
      };

    } else if (type === 'heating_optimization') {
      useToolCalling = true;
      toolName = 'create_heating_plan';
      
      // Calculate averages from readings
      const avgPower = readings.reduce((sum: number, r: any) => sum + (r.power_io || 0), 0) / readings.length;
      const avgSoc = readings.reduce((sum: number, r: any) => sum + (r.battery_soc || 50), 0) / readings.length;
      const maxPvPower = Math.max(...readings.map((r: any) => r.pv_power || 0));
      
      // Extract time patterns
      const hourlyData: Record<number, number[]> = {};
      readings.forEach((r: any) => {
        const hour = new Date(r.timestamp).getHours();
        if (!hourlyData[hour]) hourlyData[hour] = [];
        hourlyData[hour].push(r.power_io || 0);
      });
      
      const hourlyAvg = Object.entries(hourlyData).map(([hour, values]) => ({
        hour: parseInt(hour),
        avgPower: values.reduce((a, b) => a + b, 0) / values.length
      })).sort((a, b) => a.hour - b.hour);

      prompt = `Du bist ein Experte für Energiemanagement und Fußbodenheizung mit PV und Batterie.

Analysiere diese Daten und erstelle einen optimalen Heizplan für einen TGP508 WiFi-Thermostat (6 Zeitperioden):

**Anlagen-Konfiguration:**
- PV-Kapazität: ${heatingSettings?.pv_capacity_kwp || 15.8} kWp
- Batterie-Kapazität: ${heatingSettings?.battery_capacity_kwh || 13.8} kWh
- Ziel-SOC für Heizung: ${heatingSettings?.target_battery_soc || 80}%
- Min-SOC Reserve: ${heatingSettings?.min_battery_soc || 20}%
- Komfort-Temperatur: ${heatingSettings?.comfort_temp || 21}°C
- Eco-Temperatur: ${heatingSettings?.eco_temp || 19}°C
- Nacht-Temperatur: ${heatingSettings?.night_temp || 18}°C

**Aktuelle Energiedaten:**
- Durchschnittliche Leistung: ${avgPower.toFixed(0)}W
- Durchschnittlicher Batterie-SOC: ${avgSoc.toFixed(0)}%
- Max. PV-Leistung gemessen: ${maxPvPower.toFixed(0)}W

**Stündliche Durchschnittsleistung (W, negativ = Einspeisung):**
${hourlyAvg.map(h => `${h.hour}:00 Uhr: ${h.avgPower.toFixed(0)}W`).join('\n')}

**Optimierungsziele:**
1. Estrich als Wärmespeicher nutzen (Vorheizen bei PV-Überschuss)
2. Batterie für Abend/Nacht priorisieren (erst laden, dann heizen)
3. Heizung bei niedrigem SOC reduzieren
4. Nachtabsenkung nutzen (Wärme im Estrich hält)

Erstelle einen optimalen 6-Perioden-Plan für den TGP508.`;

      toolDefinition = {
        type: "function",
        function: {
          name: "create_heating_plan",
          description: "Erstellt einen optimierten 6-Perioden-Heizplan für den TGP508 Thermostat",
          parameters: {
            type: "object",
            properties: {
              periods: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    period: { type: "number", description: "Periodennummer 1-6" },
                    startTime: { type: "string", description: "Startzeit im Format HH:MM" },
                    endTime: { type: "string", description: "Endzeit im Format HH:MM" },
                    temperature: { type: "number", description: "Empfohlene Temperatur in °C" },
                    reason: { type: "string", description: "Begründung für diese Einstellung" },
                    icon: { type: "string", enum: ["sun", "battery", "moon", "thermometer"], description: "Icon-Typ: sun=PV-Heizen, battery=Batterie-Priorität, moon=Nacht, thermometer=Normal" }
                  },
                  required: ["period", "startTime", "endTime", "temperature", "reason", "icon"]
                }
              },
              summary: { type: "string", description: "Zusammenfassung des Plans" },
              expectedPvSurplus: { type: "number", description: "Erwarteter PV-Überschuss in kWh" },
              batteryStrategy: { type: "string", description: "Batterie-Strategie Erklärung" },
              recommendations: {
                type: "array",
                items: { type: "string" },
                description: "Zusätzliche Empfehlungen"
              }
            },
            required: ["periods", "summary", "expectedPvSurplus", "batteryStrategy", "recommendations"]
          }
        }
      };

    } else if (type === 'daily_pattern') {
      prompt = `Analysiere diese Energiedaten und identifiziere Tagesmuster:

Daten (Zeitstempel, Leistung in W, Energie Import kWh, Energie Export kWh):
${readings.map((r: any) => `${r.timestamp}: ${r.power_io}W, Import: ${r.energy_in}kWh, Export: ${r.energy_out}kWh`).join('\n')}

Bitte analysiere:
1. Typische Verbrauchsmuster (Morgenpeak, Mittagspeak, Abendpeak)
2. Zeiten mit hohem Eigenverbrauch vs. Netzimport
3. Zeiten mit Überschusseinspeisung
4. Auffälligkeiten oder Anomalien

Antworte auf Deutsch mit konkreten Uhrzeiten und Werten.`;
    } else if (type === 'weekly_comparison') {
      prompt = `Vergleiche diese Energiedaten über die Woche:

${readings.map((r: any) => `${r.date}: Peak: ${r.peak_power}W, Durchschnitt: ${r.avg_power}W, Import: ${r.total_energy_in}kWh, Export: ${r.total_energy_out}kWh`).join('\n')}

Analysiere:
1. Unterschiede zwischen Wochentagen und Wochenende
2. Trends über die Woche
3. Beste und schlechteste Tage für Eigenverbrauch
4. Empfehlungen zur Optimierung

Antworte auf Deutsch mit konkreten Zahlen und Empfehlungen.`;
    } else {
      prompt = `Analysiere diese Echtzeit-Energiedaten:

Aktuelle Leistung: ${readings.power_io}W
Heute Import: ${readings.energy_in}kWh
Heute Export: ${readings.energy_out}kWh

Gib eine kurze Einschätzung der aktuellen Situation (1-2 Sätze auf Deutsch).`;
    }

    // Build request body
    const requestBody: any = {
      model: 'google/gemini-2.5-flash',
      messages: [
        { 
          role: 'system', 
          content: 'Du bist ein Experte für Energiemanagement, Photovoltaik-Anlagen und elektrische Fußbodenheizung. Analysiere Energiedaten präzise und gib praktische Empfehlungen. Antworte immer auf Deutsch.' 
        },
        { role: 'user', content: prompt }
      ],
    };

    // Add tool calling for heating optimization
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
        return new Response(JSON.stringify({ error: 'Rate limit erreicht, bitte später erneut versuchen.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Zahlungspflichtig, bitte Credits aufladen.' }), {
          status: 402,
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
          
          if (toolName === 'create_room_heating_plan') {
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

    // Fallback to regular text response
    const analysis = data.choices?.[0]?.message?.content || 'Keine Analyse verfügbar.';
    console.log('Analysis completed successfully');

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in analyze-patterns:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unbekannter Fehler' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
