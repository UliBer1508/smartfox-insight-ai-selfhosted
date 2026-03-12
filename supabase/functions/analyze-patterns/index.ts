import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===========================================
// AI PROVIDER ABSTRACTION (Google AI + Fallback)
// ===========================================

interface AIRequestBody {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  tools?: unknown[];
  tool_choice?: unknown;
}

interface AIResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

// Google AI API Call (kostenlos)
async function callGoogleAI(requestBody: AIRequestBody): Promise<AIResponse> {
  const GOOGLE_AI_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!GOOGLE_AI_KEY) {
    return { ok: false, status: 0, error: 'GOOGLE_AI_API_KEY not configured' };
  }

  try {
    // Convert OpenAI-style messages to Google Gemini format
    const contents = requestBody.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    // System prompt als erstes Teil der ersten User-Nachricht
    const systemPrompt = requestBody.messages.find(m => m.role === 'system')?.content;
    if (systemPrompt && contents.length > 0 && contents[0].role === 'user') {
      contents[0].parts.unshift({ text: `[System]: ${systemPrompt}\n\n` });
    }

    // Tool definitions für Google Format konvertieren
    let tools: unknown[] | undefined;
    if (requestBody.tools && Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
      tools = [{
        functionDeclarations: requestBody.tools.map((t: any) => ({
          name: t.function?.name || t.name,
          description: t.function?.description || t.description,
          parameters: t.function?.parameters || t.parameters
        }))
      }];
    }

    const googleBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096
      }
    };

    if (tools) {
      googleBody.tools = tools;
      // Force tool call if specified
      if (requestBody.tool_choice && typeof requestBody.tool_choice === 'object') {
        const toolChoice = requestBody.tool_choice as { function?: { name: string } };
        if (toolChoice.function?.name) {
          googleBody.toolConfig = {
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames: [toolChoice.function.name]
            }
          };
        }
      }
    }

    console.log('Calling Google AI (gemini-2.5-flash)...');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(googleBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google AI error:', response.status, errorText);
      return { ok: false, status: response.status, error: errorText };
    }

    const googleData = await response.json();
    console.log('Google AI response received');

    // Convert Google response to OpenAI-compatible format
    const candidate = googleData.candidates?.[0];
    const content = candidate?.content;

    if (content?.parts?.[0]?.functionCall) {
      // Tool call response
      const functionCall = content.parts[0].functionCall;
      return {
        ok: true,
        status: 200,
        data: {
          choices: [{
            message: {
              tool_calls: [{
                function: {
                  name: functionCall.name,
                  arguments: JSON.stringify(functionCall.args)
                }
              }]
            }
          }]
        }
      };
    } else {
      // Text response
      const textContent = content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
      return {
        ok: true,
        status: 200,
        data: {
          choices: [{
            message: {
              content: textContent
            }
          }]
        }
      };
    }
  } catch (err) {
    console.error('Google AI exception:', err);
    return { ok: false, status: 0, error: String(err) };
  }
}

// Unified AI call - Google AI only (no paid fallback)
async function callAI(requestBody: AIRequestBody): Promise<AIResponse> {
  const googleResponse = await callGoogleAI(requestBody);
  
  if (googleResponse.ok) {
    console.log('✅ Using Google AI (free)');
    return googleResponse;
  }
  
  console.error(`❌ Google AI failed (${googleResponse.status}): ${googleResponse.error}`);
  return googleResponse;
}

// Hilfsfunktion: Prüft ob aktuell Nachtzeit ist basierend auf Benutzereinstellungen
function isNightTimeFromSettings(
  nightStart: string = '22:00', 
  nightEnd: string = '08:00',
  timezone: string = 'Europe/Berlin'
): boolean {
  const now = new Date();
  const localTimeStr = now.toLocaleTimeString('de-DE', { 
    timeZone: timezone, 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  const [currentH, currentM] = localTimeStr.split(':').map(Number);
  const currentMinutes = currentH * 60 + currentM;
  
  const [startH, startM] = nightStart.split(':').map(Number);
  const [endH, endM] = nightEnd.split(':').map(Number);
  
  const nightStartMinutes = startH * 60 + startM;
  const nightEndMinutes = endH * 60 + endM;
  
  // Nacht über Mitternacht (z.B. 20:00-08:00)
  if (nightStartMinutes > nightEndMinutes) {
    return currentMinutes >= nightStartMinutes || currentMinutes < nightEndMinutes;
  }
  // Nacht am selben Tag
  return currentMinutes >= nightStartMinutes && currentMinutes < nightEndMinutes;
}

// Hilfsfunktion: Lokale Stunde ermitteln
function getLocalHour(timezone: string = 'Europe/Berlin'): number {
  const now = new Date();
  return parseInt(now.toLocaleTimeString('de-DE', { 
    timeZone: timezone, 
    hour: '2-digit',
    hour12: false 
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication: Validate JWT token or known key
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = authHeader.replace('Bearer ', '');

    const knownKeys = [serviceRoleKey, Deno.env.get('SUPABASE_ANON_KEY'), Deno.env.get('SUPABASE_PUBLISHABLE_KEY')].filter(Boolean);
    let isAuthorized = knownKeys.includes(token);

    if (!isAuthorized) {
      try {
        const payloadB64 = token.split('.')[1];
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
          const role = payload.role || payload.aud;
          isAuthorized = ['anon', 'authenticated', 'service_role'].includes(role);
          if (!isAuthorized) console.error(`[analyze-patterns] Auth rejected: role=${role}`);
        }
      } catch (e) {
        console.error(`[analyze-patterns] JWT decode failed: ${e}`);
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const {
      readings, 
      heatingSettings, 
      rooms, 
      consumerLogs, 
      type,
      mlFeatures,
      weatherData,
      recentRewards,
      pvForecast,
      automationHistory
    } = await req.json();
    
    console.log(`Analyzing type: ${type}, readings: ${readings?.length || 0}, rooms: ${rooms?.length || 0}, automationHistory: ${automationHistory?.length || 0}`);
    
    // API keys werden in callAI geprüft - kein früher Abbruch mehr nötig

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
      
      // Nachtzeiten aus Benutzereinstellungen verwenden!
      const nightStart = heatingSettings?.night_start_time || '22:00';
      const nightEnd = heatingSettings?.night_end_time || '08:00';
      const isNight = isNightTimeFromSettings(nightStart, nightEnd, 'Europe/Berlin');
      const localHour = getLocalHour('Europe/Berlin');
      
      // Morgen beginnt nach Nachtende, nicht hart kodiert
      const [nightEndH] = (nightEnd || '08:00').split(':').map(Number);
      const isMorning = !isNight && localHour >= nightEndH && localHour < nightEndH + 2;
      const isPeakSolar = !isNight && localHour >= 10 && localHour < 16;
      
      console.log(`Night check: nightStart=${nightStart}, nightEnd=${nightEnd}, localHour=${localHour}, isNight=${isNight}, isMorning=${isMorning}`);
      
      // Warmwasser-Einstellungen
      const hotwaterEnabled = heatingSettings?.hotwater_enabled !== false;
      const hotwaterPower = heatingSettings?.hotwater_power_w || 6000;
      const hotwaterStart = heatingSettings?.hotwater_schedule_start || '12:00';
      const hotwaterEnd = heatingSettings?.hotwater_schedule_end || '16:00';
      const hotwaterMinSurplus = heatingSettings?.hotwater_min_surplus_w || 1000;
      
      // Nachtzyklen-Einstellungen (nightStart/nightEnd bereits oben definiert)
      const nightCyclingEnabled = heatingSettings?.night_cycling_enabled !== false;
      const avgNightCycles = heatingSettings?.avg_night_cycles_per_room || 3;
      
      // Heizungstyp ermitteln
      const heatingTypeRaw = heatingSettings?.heating_type || 'direct_electric';
      const heatingTypeLabels: Record<string, string> = {
        'direct_electric': 'Direkte elektrische Fußbodenheizung (Stromdirektheizung)',
        'heat_pump': 'Wärmepumpe',
        'water': 'Wasserbasierte Heizung'
      };
      const heatingTypeLabel = heatingTypeLabels[heatingTypeRaw] || 'Stromdirektheizung';
      const totalHeatingPower = heatingSettings?.total_heating_power_w || 
        rooms?.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.heating_power_w as number) || (r.calculated_power_w as number) || 800), 0) || 0;
      
      // Dachausrichtung für PV
      const roofAzimuth = heatingSettings?.roof_azimuth || 0;
      const roofDeclination = heatingSettings?.roof_declination || 35;
      
      // PV-Prognose verarbeiten
      const hourlyWatts = pvForecast?.hourly_watts as Record<string, number> | null;
      let hourlyPvData = 'Keine Prognose verfügbar';
      let peakHours: string[] = [];
      let pvPeakPower = 0;
      let expectedKwh = 0;
      
      if (hourlyWatts && typeof hourlyWatts === 'object') {
        // Stündliche Daten formatieren (nur signifikante Werte)
        hourlyPvData = Object.entries(hourlyWatts)
          .filter(([_, watts]) => (watts as number) > 100)
          .map(([time, watts]) => {
            const timeStr = (time as string).includes(' ') ? (time as string).split(' ')[1]?.substring(0,5) : time;
            return `${timeStr}: ${Math.round(watts as number)}W`;
          })
          .join(', ');
        
        // Peak-Stunden ermitteln (>5kW)
        peakHours = Object.entries(hourlyWatts)
          .filter(([_, watts]) => (watts as number) > 5000)
          .map(([time]) => {
            const t = time as string;
            return t.includes(' ') ? t.split(' ')[1]?.substring(0,5) : t;
          })
          .filter(Boolean) as string[];
        
        // Maximale PV-Leistung
        pvPeakPower = Math.max(...Object.values(hourlyWatts).map(w => w as number));
        expectedKwh = pvForecast?.expected_kwh || 0;
      }
      
      prompt = `Du bist ein ML-basiertes Heizungsoptimierungssystem. Dein Ziel ist es, Energie zu sparen und Komfort zu gewährleisten.

⚠️ **WICHTIG: ALLE ERFORDERLICHEN DATEN SIND UNTEN AUFGEFÜHRT. GIB NUR KONKRETE EMPFEHLUNGEN, KEINE RÜCKFRAGEN!**

**HEIZUNGSANLAGE (BEKANNT):**
- Typ: ${heatingTypeLabel}
- Gesamt-Heizleistung: ${totalHeatingPower}W
- Thermostate: TGP508 WiFi (6 Zeitperioden programmierbar)
- Charakteristik: Direkte Wärmeabgabe, geringe thermische Masse, schnelle Reaktion

**ZEITPUNKT:** ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} (${isNight ? 'Nacht' : isMorning ? 'Morgen' : isPeakSolar ? 'Hauptsonnenzeit' : 'Nachmittag/Abend'})

**ENERGIESITUATION:**
- PV-Überschuss: ${surplus}W ${surplus > 500 ? '✅ gut' : surplus > 0 ? '➖ gering' : '❌ Netzbezug'}
- Batterie-SOC: ${batterySoc}% ${batterySoc > 80 ? '✅' : batterySoc > 50 ? '➖' : batterySoc > 20 ? '⚠️' : '❌'}
- PV-Leistung: ${pvPower}W
- Verbrauch: ${consumption}W

**WETTER:**
${weatherData ? `- Außentemp: ${weatherData.temperature_c}°C, Bewölkung: ${weatherData.cloud_cover_percent}%, Strahlung: ${weatherData.direct_radiation_wm2 || 0}W/m²` : '- Keine Wetterdaten verfügbar'}

**PV-PROGNOSE (basierend auf Dachausrichtung: Azimut ${roofAzimuth}°, Neigung ${roofDeclination}°):**
- Erwartete Tagesproduktion: ${expectedKwh.toFixed(1)} kWh
- Maximale Leistung: ${Math.round(pvPeakPower)}W
- Sonnenaufgang: ${pvForecast?.sunrise || '?'} | Sonnenuntergang: ${pvForecast?.sunset || '?'}
- **Peak-Stunden (>5kW):** ${peakHours.length > 0 ? peakHours.join(', ') : 'keine signifikanten Peaks'}
- Stündliche Leistung: ${hourlyPvData}

**WARMWASSER (EXTERN - SmartFox gesteuert):**
- Aktuelle Einstellung: ${hotwaterStart}-${hotwaterEnd}
- Leistung: ${hotwaterPower}W, Mind. Überschuss: ${hotwaterMinSurplus}W
- ⚠️ **NUR während Peak-Stunden empfehlen!** Zeitfenster muss innerhalb ${peakHours[0] || '10:00'}-${peakHours[peakHours.length-1] || '15:00'} liegen, da nur dann genug PV-Leistung verfügbar ist

**NACHTZYKLEN:**
- Aktuell: ${nightCyclingEnabled ? `${avgNightCycles} Zyklen/Raum` : 'Deaktiviert'}
- Nacht: ${nightStart}-${nightEnd}
- Empfehle Anzahl basierend auf Außentemperatur und Batterie-Reserve

**GLOBALE TEMPERATUREINSTELLUNGEN:**
- Komfort: ${heatingSettings?.comfort_temp || 21}°C, Eco: ${heatingSettings?.eco_temp || 18}°C, Nacht: ${heatingSettings?.night_temp || 16}°C
- Min. SOC: ${heatingSettings?.min_battery_soc || 20}%, PV-Schwelle EIN: ${heatingSettings?.pv_surplus_threshold_on || 500}W, AUS: ${heatingSettings?.pv_surplus_threshold_off || 200}W

**RÄUME MIT VOLLSTÄNDIGEN EINSTELLUNGEN:**
${rooms?.map((r: Record<string, unknown>) => {
  const f = mlFeatures?.find((mf: Record<string, unknown>) => mf.room_id === r.id);
  return `📍 ${r.name} (${r.id}):
   Ist-Temp: ${r.current_temp || '?'}°C → Soll-Temp: ${r.target_temp || '?'}°C
   Comfort: ${r.comfort_temp || heatingSettings?.comfort_temp || 21}°C | Eco: ${r.eco_temp || heatingSettings?.eco_temp || 18}°C | Nacht: ${r.night_temp || heatingSettings?.night_temp || 16}°C
   Heizleistung: ${r.heating_power_w || r.calculated_power_w || 1000}W | PV-Auto aktiv: ${r.pv_auto_active ? '🔥 Ja' : '❄️ Nein'}
   ${f ? `ML: Wärmeverlust ${(f.heat_loss_rate_deg_per_hour as number)?.toFixed(2) || '?'}°/h, Aufheizrate ${(f.heating_rate_deg_per_hour as number)?.toFixed(2) || '?'}°/h, PV-Anteil ${(((f.pv_heating_ratio as number) || 0) * 100).toFixed(0)}%, Konfidenz ${(((f.confidence as number) || 0) * 100).toFixed(0)}%` : '⚠️ Keine ML-Features (Lernphase)'}`;
}).join('\n\n') || 'Keine Räume konfiguriert'}

**FEEDBACK & LERNFORTSCHRITT (evaluierte Entscheidungen):**
${(() => {
  if (!recentRewards || recentRewards.length === 0) {
    return '⏳ Noch keine evaluierten Events - Selbstlernzyklus startet nach 2h';
  }
  
  const evaluatedEvents = recentRewards.filter((r: Record<string, unknown>) => r.reward !== null);
  if (evaluatedEvents.length === 0) {
    return '⏳ Events warten auf Evaluation (nach 2h)';
  }
  
  const avgReward = evaluatedEvents.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.reward as number) || 0), 0) / evaluatedEvents.length;
  const positiveCount = evaluatedEvents.filter((r: Record<string, unknown>) => (r.reward as number) > 0).length;
  const negativeCount = evaluatedEvents.filter((r: Record<string, unknown>) => (r.reward as number) < 0).length;
  
  let summary = `📊 STATISTIK: ${evaluatedEvents.length} evaluiert | Ø Reward: ${avgReward.toFixed(2)} | ✅ ${positiveCount} gut | ❌ ${negativeCount} schlecht\n\n`;
  
  summary += 'LETZTE 5 ENTSCHEIDUNGEN:\n';
  summary += evaluatedEvents.slice(0, 5).map((r: Record<string, unknown>) => {
    const reward = r.reward as number;
    const breakdown = r.reward_breakdown as Record<string, number> | undefined;
    const icon = reward > 0.5 ? '✅' : reward > 0 ? '➖' : '❌';
    
    let details = `${icon} ${r.decision_type}: Reward ${reward.toFixed(2)}`;
    if (breakdown) {
      details += `\n   PV-Nutzung: ${(breakdown.pv_usage_bonus || 0).toFixed(2)} | Komfort: ${(breakdown.comfort_bonus || 0).toFixed(2)} | Prognose: ${(breakdown.forecast_quality || 0).toFixed(2)}`;
    }
    return details;
  }).join('\n');
  
  // Lern-Hinweis basierend auf Trends
  if (avgReward < 0) {
    summary += '\n\n⚠️ LERNHINWEIS: Negativer Durchschnitts-Reward! Strategieänderung empfohlen:';
    summary += '\n- Bei schlechter PV-Nutzung: Heizung stärker auf Sonnenspitzen konzentrieren';
    summary += '\n- Bei schlechtem Komfort: Vorheizzeit erhöhen oder Zieltemperatur anpassen';
  } else if (avgReward > 0.5) {
    summary += '\n\n✅ LERNHINWEIS: Positive Entwicklung! Aktuelle Strategie beibehalten.';
  }
  
  return summary;
})()}

**🤖 DEINE AUTOMATIK-ENTSCHEIDUNGEN HEUTE (DU BIST DAS STEUERNDE SYSTEM!):**
${(() => {
  if (!automationHistory || automationHistory.length === 0) {
    return '⚠️ Noch keine Automatik-Entscheidungen heute - Erste Analyse des Tages';
  }
  
  // Gruppiere nach Raum
  const roomDecisions: Record<string, Array<Record<string, unknown>>> = {};
  automationHistory.forEach((e: Record<string, unknown>) => {
    const roomId = e.room_id as string || 'global';
    if (!roomDecisions[roomId]) roomDecisions[roomId] = [];
    roomDecisions[roomId].push(e);
  });
  
  return Object.entries(roomDecisions).map(([roomId, decisions]) => {
    const roomName = rooms?.find((r: Record<string, unknown>) => r.id === roomId)?.name || 'Global';
    const activations = decisions.filter((d: Record<string, unknown>) => d.decision_type === 'activate').length;
    const deactivations = decisions.filter((d: Record<string, unknown>) => d.decision_type === 'deactivate').length;
    const lastDecision = decisions[0];
    const lastAction = lastDecision?.action as Record<string, unknown> | undefined;
    const lastContext = lastDecision?.context as Record<string, unknown> | undefined;
    const lastTime = lastDecision?.timestamp ? new Date(lastDecision.timestamp as string).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '?';
    
    return `📍 ${roomName}:
   Heute: ${activations}x aktiviert, ${deactivations}x deaktiviert
   Letzte Aktion (${lastTime}): ${lastDecision?.decision_type || '?'} → ${(lastAction?.target_temp as number) || '?'}°C
   Begründung: ${(lastAction?.reasoning as string)?.substring(0, 100) || 'keine'}${(lastAction?.reasoning as string)?.length > 100 ? '...' : ''}
   Kontext: PV ${lastContext?.pv_power || '?'}W, SOC ${lastContext?.battery_soc || '?'}%, Raum-Temp ${lastContext?.room_temp || '?'}°C`;
  }).join('\n\n');
})()}

**⚠️ WICHTIG - REGELN FÜR DEINE EMPFEHLUNGEN:**
1. Du BIST das System, das die Thermostate steuert - empfehle NICHT, was du bereits tust!
2. Wenn du einen Raum heute auf Eco gestellt hast wegen mangelndem PV-Überschuss, ist "Intensität reduzieren" keine sinnvolle Empfehlung
3. Fokussiere auf ÄNDERUNGEN deiner Strategie, nicht auf Bestätigung des Status Quo
4. Falls alles optimal läuft, sage klar: "Aktuelle Automatik-Strategie ist optimal"
5. Empfehle nur Anpassungen, die über deine bisherigen Entscheidungen hinausgehen

**REGELN FÜR STROMDIREKTHEIZUNG:**
1. PV-Überschuss >${heatingSettings?.pv_surplus_threshold_on || 500}W → Heizung auf Comfort-Temp aktivieren
2. PV-Überschuss <${heatingSettings?.pv_surplus_threshold_off || 200}W → Auf Eco-Temp reduzieren
3. Nachts Nacht-Temp verwenden (Fronius verwaltet Batterie eigenständig)
5. Räume mit hohem PV-Anteil (ML) bevorzugt während Sonnenstunden heizen
6. Geringe thermische Masse = schnelle Reaktion → häufigere, kürzere Heizphasen möglich

**AUFGABEN (NUR EMPFEHLUNGEN, KEINE FRAGEN):**
1. Gib für jeden Raum eine Thermostat-Empfehlung (Zieltemperatur + Aktion: activate/deactivate/keep)
2. Empfehle optimales Warmwasser-Zeitfenster (HH:MM-HH:MM) für maximale PV-Nutzung
3. Erstelle TGP508 Heizprogramm mit 6 Perioden (Start/Ende/Temp/Modus) für PV-optimiertes Lastmanagement
4. Empfehle Nachtzyklen-Anzahl (0-6 pro Raum) basierend auf Außentemperatur`;

      toolDefinition = {
        type: "function",
        function: {
          name: "make_heating_decision",
          description: "ML-basierte Heizungsentscheidungen mit konkreten Einstellungen für Thermostate, Warmwasser und Heizzyklen",
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
                },
                description: "Thermostat-Empfehlungen pro Raum"
              },
              overall_strategy: { type: "string", description: "Zusammenfassung der Gesamtstrategie" },
              expected_total_savings_wh: { type: "number" },
              hotwater_recommendation: {
                type: "object",
                properties: {
                  enabled: { type: "boolean", description: "Warmwasser heute sinnvoll?" },
                  recommended_start: { type: "string", description: "Empfohlene Startzeit HH:MM" },
                  recommended_end: { type: "string", description: "Empfohlene Endzeit HH:MM" },
                  min_surplus_w: { type: "number", description: "Mindest-PV-Überschuss in Watt" },
                  reasoning: { type: "string", description: "Begründung für das Zeitfenster" }
                },
                required: ["enabled", "recommended_start", "recommended_end", "reasoning"],
                description: "Empfehlung für externe Warmwasser-Bereitung (SmartFox)"
              },
              thermostat_schedule: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    period: { type: "number", description: "Periode 1-6" },
                    start_time: { type: "string", description: "Startzeit HH:MM" },
                    end_time: { type: "string", description: "Endzeit HH:MM" },
                    temperature: { type: "number", description: "Zieltemperatur in °C" },
                    mode: { type: "string", enum: ["comfort", "eco", "night", "off"], description: "Heizmodus" },
                    reasoning: { type: "string", description: "Kurze Begründung" }
                  },
                  required: ["period", "start_time", "end_time", "temperature", "mode"]
                },
                description: "TGP508 Heizprogramm mit exakt 6 Perioden",
                minItems: 6,
                maxItems: 6
              },
              night_cycling: {
                type: "object",
                properties: {
                  enabled: { type: "boolean", description: "Nachtzyklen aktivieren?" },
                  cycles_per_room: { type: "number", description: "Anzahl Zyklen pro Raum (0-6)" },
                  reasoning: { type: "string", description: "Begründung" }
                },
                required: ["enabled", "cycles_per_room", "reasoning"],
                description: "Empfehlung für Nacht-Heizzyklen"
              }
            },
            required: ["decisions", "overall_strategy", "hotwater_recommendation", "thermostat_schedule", "night_cycling"]
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

      const heatingTypeLabels: Record<string, string> = {
        'direct_electric': 'Direkte elektrische Fußbodenheizung (Stromdirektheizung)',
        'heat_pump': 'Wärmepumpe',
        'water': 'Wasserbasierte Heizung'
      };
      const heatingTypeLabel = heatingTypeLabels[heatingType] || 'Stromdirektheizung';

      const heatingTypeInfo = `
**HEIZUNGSANLAGE:**
- Typ: ${heatingTypeLabel}
- Gesamtleistung: ${totalInstalledPower}W
- Thermostate: TGP508 WiFi (6 Zeitperioden programmierbar)
${heatingType === 'direct_electric' ? '- WICHTIG: Gib NUR Empfehlungen für direkte elektrische Heizung, KEINE Wärmepumpen-Tipps!' : ''}
`;

      // Hotwater config
      const hotwaterEnabled = heatingSettings?.hotwater_enabled !== false;
      const hotwaterPower = heatingSettings?.hotwater_power_w || 2800;
      const hotwaterStart = heatingSettings?.hotwater_schedule_start || '10:00';
      const hotwaterEnd = heatingSettings?.hotwater_schedule_end || '16:00';

      const hotwaterInfo = hotwaterEnabled ? `
**Warmwasser:** ${hotwaterPower}W, ${hotwaterStart}-${hotwaterEnd}
` : '';

      // PV-basierte Temperatur-Entscheidung
      const pvThresholdForComfort = 800; // Mindest-PV in Watt für Komfort
      const canUseComfort = currentPvPower >= pvThresholdForComfort || avgSoc > 80;
      const shouldUseNight = avgSoc < 30 && currentPvPower === 0;
      const currentTime = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

      const temperatureGuideline = canUseComfort 
        ? `✅ PV-Überschuss vorhanden (${currentPvPower}W) - Komfort-Temperaturen ERLAUBT`
        : shouldUseNight
          ? `❌ KEIN PV und niedrige Batterie (${avgSoc.toFixed(0)}%) - NUR Nacht-Temperaturen!`
          : `⚠️ Wenig PV (${currentPvPower}W) - NUR Eco-Temperaturen erlaubt`;

      prompt = `Erstelle RAUMSPEZIFISCHE Heizempfehlungen:
${heatingTypeInfo}
**Anlage:** PV ${heatingSettings?.pv_capacity_kwp || 15.8}kWp, Batterie ${heatingSettings?.battery_capacity_kwh || 13.8}kWh, SOC ${avgSoc.toFixed(0)}%
**Energie AKTUELL:** PV ${currentPvPower}W, Max heute ${maxPvPower}W, Durchschnitt ${avgPower.toFixed(0)}W

**🎯 AKTUELLE TEMPERATUR-REGEL: ${temperatureGuideline}**

**⚠️ STRIKTE TEMPERATUR-REGELN (UNBEDINGT EINHALTEN!):**

1. **Komfort-Temperatur** NUR erlaubt wenn:
   - PV aktuell >= ${pvThresholdForComfort}W (ca. 1 Raum Heizleistung)
   - ODER Batterie SOC > 80%
   
2. **Eco-Temperatur** als Standard wenn:
   - PV < ${pvThresholdForComfort}W UND Batterie SOC zwischen 30-80%
   
3. **Nacht-Temperatur** PFLICHT wenn:
   - PV = 0W UND Batterie SOC < 30%
   - ODER Uhrzeit zwischen ${heatingSettings?.night_start_time || '22:00'} und ${heatingSettings?.night_end_time || '06:00'}

4. **🚫 VERBOTEN: Komfort bei PV = 0W und SOC < 50%!**

**Stündlich:** ${hourlyAvg.map(h => `${h.hour}h: ${h.avgPower.toFixed(0)}W`).join(', ')}
${hotwaterInfo}
**Räume:**
${roomsList}

**Uhrzeit:** ${currentTime}

**Prioritäts-Zuordnung basierend auf ENERGIE:**
- heat_now: PV >= Raumleistung, sofort auf Komfort heizen
- preheat: PV-Prognose gut, auf Eco vorheizen  
- hold: Eco halten (NUR bei SOC > 50%)
- reduce: Auf Nacht-Temp senken (Energie sparen)
- off: Heizung aus

Erstelle für JEDEN Raum eine Empfehlung. BEACHTE DIE AKTUELLE ENERGIE-SITUATION!`;

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
      
      // Heizungstyp ermitteln
      const heatingTypeRaw = heatingSettings?.heating_type || 'direct_electric';
      const heatingTypeLabels: Record<string, string> = {
        'direct_electric': 'Direkte elektrische Fußbodenheizung (Stromdirektheizung)',
        'heat_pump': 'Wärmepumpe',
        'water': 'Wasserbasierte Heizung'
      };
      const heatingTypeLabel = heatingTypeLabels[heatingTypeRaw] || 'Stromdirektheizung';
      
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

**HEIZUNGSANLAGE:**
- Typ: ${heatingTypeLabel}
- Thermostate: TGP508 WiFi (6 Zeitperioden programmierbar)
${heatingTypeRaw === 'direct_electric' ? '- Charakteristik: Direkte Stromumwandlung in Wärme, keine Wärmepumpe!\n- WICHTIG: Gib NUR Empfehlungen für direkte elektrische Heizung, KEINE Wärmepumpen-Tipps!' : ''}

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
      
      // Heizungstyp ermitteln
      const heatingTypeRaw = heatingSettings?.heating_type || 'direct_electric';
      const heatingTypeLabels: Record<string, string> = {
        'direct_electric': 'Direkte elektrische Fußbodenheizung (Stromdirektheizung)',
        'heat_pump': 'Wärmepumpe',
        'water': 'Wasserbasierte Heizung'
      };
      const heatingTypeLabel = heatingTypeLabels[heatingTypeRaw] || 'Stromdirektheizung';
      
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

**HEIZUNGSANLAGE:** ${heatingTypeLabel}
${heatingTypeRaw === 'direct_electric' ? '(Keine Wärmepumpe - nur Stromdirektheizung-relevante Tipps!)' : ''}

**Bekannte Verbraucher:** Heizung ${totalHeatingPower}W (${roomsList}), Warmwasser ${heatingSettings?.hotwater_power_w || 6000}W
${consumerActivity}
**Daten:**
${readings.map((r: Record<string, unknown>) => `${r.timestamp}: ${r.power_io}W, PV: ${r.pv_power || 0}W, SOC: ${r.battery_soc || 0}%`).join('\n')}

Ordne Spitzen den bekannten Verbrauchern zu. Antworte auf Deutsch.`;

    } else if (type === 'weekly_comparison') {
      const totalHeatingPower = rooms?.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.heating_power_w as number) || 800), 0) || 0;
      
      // Heizungstyp ermitteln
      const heatingTypeRaw = heatingSettings?.heating_type || 'direct_electric';
      const heatingTypeLabels: Record<string, string> = {
        'direct_electric': 'Direkte elektrische Fußbodenheizung (Stromdirektheizung)',
        'heat_pump': 'Wärmepumpe',
        'water': 'Wasserbasierte Heizung'
      };
      const heatingTypeLabel = heatingTypeLabels[heatingTypeRaw] || 'Stromdirektheizung';

      prompt = `Wochenvergleich:

**HEIZUNGSANLAGE:** ${heatingTypeLabel}
${heatingTypeRaw === 'direct_electric' ? '(Keine Wärmepumpe - nur Stromdirektheizung-relevante Tipps!)' : ''}

**Verbraucher:** Heizung ${totalHeatingPower}W, Warmwasser ${heatingSettings?.hotwater_power_w || 6000}W
**Batterie:** ${heatingSettings?.battery_capacity_kwh || 13.8}kWh, Min-SoC ${heatingSettings?.min_battery_soc || 20}%

**Daten:**
${readings.map((r: Record<string, unknown>) => `${r.date}: Peak ${r.peak_power}W, Avg ${r.avg_power}W, Import ${r.total_energy_in}kWh, Export ${r.total_energy_out}kWh`).join('\n')}

Analysiere Trends und gib Empfehlungen. Deutsch.`;

    } else {
      prompt = `Aktueller Energiestatus:
Leistung: ${readings?.power_io}W, Import: ${readings?.energy_in}kWh, Export: ${readings?.energy_out}kWh
Kurze Einschätzung auf Deutsch.`;
    }

    const aiRequestBody: AIRequestBody = {
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'Du bist ein Experte für Energiemanagement und Heizungsoptimierung. Antworte auf Deutsch.' },
        { role: 'user', content: prompt }
      ],
    };

    if (useToolCalling && toolDefinition) {
      aiRequestBody.tools = [toolDefinition];
      aiRequestBody.tool_choice = { type: "function", function: { name: toolName } };
    }

    // Use unified AI call with Google AI (free) + Lovable AI (fallback)
    const aiResponse = await callAI(aiRequestBody);

    if (!aiResponse.ok) {
      console.error('AI error:', aiResponse.status, aiResponse.error);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit', decisions: [] }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`AI error: ${aiResponse.status} - ${aiResponse.error}`);
    }

    const data = aiResponse.data as Record<string, unknown>;
    console.log('AI response processed');

    // Handle tool calling response
    const choices = data?.choices as Array<{ message?: { tool_calls?: Array<{ function?: { name: string; arguments: string } }>; content?: string } }>;
    
    console.log(`Tool calling mode: ${useToolCalling}, toolName: ${toolName}, has tool_calls: ${!!choices?.[0]?.message?.tool_calls}`);
    
    if (useToolCalling && choices?.[0]?.message?.tool_calls) {
      const toolCall = choices[0].message.tool_calls[0];
      console.log(`Tool call received: name=${toolCall?.function?.name}, args length=${toolCall?.function?.arguments?.length || 0}`);
      
      if (toolCall?.function?.name === toolName) {
        try {
          const result = JSON.parse(toolCall.function.arguments);
          console.log(`${toolName} parsed successfully, decisions: ${result.decisions?.length || 0}`);
          
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
          console.error('Error parsing result:', parseError, 'Args:', toolCall.function.arguments?.substring(0, 200));
        }
      }
    } else if (useToolCalling) {
      // Tool calling expected but no tool_calls in response - log the content
      const contentPreview = choices?.[0]?.message?.content?.substring(0, 200) || 'no content';
      console.warn(`Expected tool call for ${toolName} but got text response: ${contentPreview}`);
    }

    const analysis = choices?.[0]?.message?.content || 'Keine Analyse verfügbar.';
    
    // Bei Tool-Calling Modus immer auch ein leeres decisions Array zurückgeben
    if (useToolCalling && toolName === 'make_heating_decision') {
      return new Response(JSON.stringify({ 
        analysis,
        decisions: [],
        error: 'Tool calling failed - AI returned text instead of structured response'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
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
