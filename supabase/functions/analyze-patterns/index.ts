import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===========================================
// AI PROVIDER: Google Gemini (direkt)
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
  data?: any;
  error?: string;
  rateLimited?: boolean;
}

interface MLDecision {
  room_id: string;
  room_name: string;
  action: 'activate' | 'deactivate' | 'keep';
  target_temp: number;
  reasoning: string;
  expected_energy_wh?: number;
  confidence?: number;
}

interface MLDecisionResponse {
  decisions?: MLDecision[];
  overall_strategy?: string;
  error?: string;
}

const TYPE_TEMPERATURE_MAP: Record<string, number> = {
  optimize_decision: 0.35,
  heating_optimization: 0.45,
  room_heating_optimization: 0.45,
  weekly_comparison: 0.45,
  weekly_comparison_auto: 0.45,
  weekly_insight: 0.45,
  daily_pattern: 0.65,
};

const TYPE_TOKEN_MAP: Record<string, number> = {
  optimize_decision: 2048,
  heating_optimization: 1024,
  room_heating_optimization: 1024,
  weekly_comparison: 1024,
  weekly_insight: 512,
  daily_pattern: 512,
  default: 1024,
};

async function callAI(requestBody: AIRequestBody, analysisType?: string): Promise<AIResponse> {
  const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!GOOGLE_AI_API_KEY) {
    return { ok: false, status: 0, error: 'GOOGLE_AI_API_KEY not configured' };
  }

  try {
    const requestedModel = requestBody.model?.replace(/^google\//, '') || 'gemini-2.5-flash';
    const modelName = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'].includes(requestedModel)
      ? requestedModel
      : 'gemini-2.5-flash';
    const temperature = TYPE_TEMPERATURE_MAP[analysisType ?? ''] ?? 0.5;
    const maxOutputTokens = TYPE_TOKEN_MAP[analysisType ?? ''] ?? TYPE_TOKEN_MAP.default;
    console.log(`Calling Google Gemini API (${modelName}, type=${analysisType ?? 'n/a'}, temp=${temperature}, maxTokens=${maxOutputTokens})...`);
    
    // Convert OpenAI-style messages to Gemini format
    const systemInstruction = requestBody.messages.find(m => m.role === 'system');
    const userMessages = requestBody.messages.filter(m => m.role !== 'system');
    
    const contents = userMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Convert tools to Gemini format
    const geminiTools = requestBody.tools ? [{
      functionDeclarations: requestBody.tools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }))
    }] : undefined;

    const geminiBody: any = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens,
      },
    };

    if (systemInstruction) {
      geminiBody.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    if (geminiTools) {
      geminiBody.tools = geminiTools;
      geminiBody.toolConfig = {
        functionCallingConfig: { mode: 'ANY' }
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429) {
        console.warn('⚠️ Gemini rate limit exceeded');
        return { ok: false, status: 429, error: 'Rate limit exceeded - verwende deterministischen Fallback', rateLimited: true };
      }
      console.error('Gemini API error:', response.status, errorText);
      return { ok: false, status: response.status, error: errorText };
    }

    const geminiData = await response.json();
    console.log('✅ Gemini API response received');

    // Convert Gemini response to OpenAI-compatible format for downstream parsing
    const candidate = geminiData.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      return { ok: false, status: 422, error: 'Gemini response truncated (MAX_TOKENS)' };
    }
    const parts = candidate?.content?.parts || [];
    
    const functionCall = parts.find((p: any) => p.functionCall);
    const textPart = parts.find((p: any) => p.text);

    const openAIFormat: any = {
      choices: [{
        message: {
          role: 'assistant',
          content: textPart?.text || null,
          tool_calls: functionCall ? [{
            function: {
              name: functionCall.functionCall.name,
              arguments: JSON.stringify(functionCall.functionCall.args),
            }
          }] : undefined,
        }
      }]
    };

    return { ok: true, status: 200, data: openAIFormat };
  } catch (err) {
    console.error('Gemini API exception:', err);
    return { ok: false, status: 0, error: String(err) };
  }
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

function buildDeterministicHeatingDecision(body: Record<string, any>, reason: string): MLDecisionResponse {
  const reading = Array.isArray(body.readings) ? body.readings[0] : body.readings;
  const settings = body.heatingSettings ?? {};
  const rooms = Array.isArray(body.rooms) ? body.rooms : [];
  const surplus = Number(reading?.power_io ?? 0) < 0 ? Math.abs(Number(reading.power_io)) : 0;
  const pvPower = Number(reading?.pv_power ?? 0);
  const batterySoc = Number(reading?.battery_soc ?? 50);
  const thresholdOn = Number(settings?.pv_surplus_threshold_on ?? 500);
  const thresholdOff = Number(settings?.pv_surplus_threshold_off ?? 200);
  const heatingMinSoc = Number(settings?.heating_min_battery_soc ?? 80);
  const isNight = isNightTimeFromSettings(settings?.night_start_time || '20:00', settings?.night_end_time || '08:00', 'Europe/Vienna');

  const decisions: MLDecision[] = rooms.map((room: Record<string, any>) => {
    const ecoTemp = Number(room.eco_temp ?? settings?.eco_temp ?? 19);
    const comfortTemp = Number(room.comfort_temp ?? settings?.comfort_temp ?? 21);
    const nightTemp = Number(room.night_temp ?? settings?.night_temp ?? 17);
    const currentTemp = Number(room.current_temp ?? room.target_temp ?? ecoTemp);
    const targetTemp = Number(room.target_temp ?? ecoTemp);
    const roomPower = Number(room.calculated_power_w ?? room.heating_power_w ?? 800);

    if (isNight) {
      return {
        room_id: String(room.id),
        room_name: String(room.name ?? 'Raum'),
        action: targetTemp > nightTemp + 0.1 ? 'deactivate' : 'keep',
        target_temp: nightTemp,
        reasoning: `${reason}: Nachtmodus, sichere Absenkung auf Nacht-Sollwert`,
        expected_energy_wh: 0,
        confidence: 0.72,
      };
    }

    if (currentTemp >= comfortTemp - 0.2 || targetTemp > comfortTemp) {
      return {
        room_id: String(room.id),
        room_name: String(room.name ?? 'Raum'),
        action: 'deactivate',
        target_temp: ecoTemp,
        reasoning: `${reason}: Komfort erreicht, Estrichspeicher nutzen und auf Eco zurücknehmen`,
        expected_energy_wh: 0,
        confidence: 0.8,
      };
    }

    if (surplus < thresholdOff || pvPower < 500 || batterySoc < heatingMinSoc) {
      return {
        room_id: String(room.id),
        room_name: String(room.name ?? 'Raum'),
        action: targetTemp > ecoTemp + 0.1 ? 'deactivate' : 'keep',
        target_temp: ecoTemp,
        reasoning: `${reason}: kein sicheres Komfort-Budget, Eco halten`,
        expected_energy_wh: 0,
        confidence: 0.75,
      };
    }

    if (surplus >= thresholdOn && pvPower >= 1000 && currentTemp < ecoTemp - 0.2) {
      return {
        room_id: String(room.id),
        room_name: String(room.name ?? 'Raum'),
        action: 'activate',
        target_temp: ecoTemp,
        reasoning: `${reason}: PV-Überschuss verfügbar, Raum zuerst auf Eco bringen`,
        expected_energy_wh: Math.round(roomPower * Math.max(0.25, ecoTemp - currentTemp) * 0.75),
        confidence: 0.78,
      };
    }

    return {
      room_id: String(room.id),
      room_name: String(room.name ?? 'Raum'),
      action: 'keep',
      target_temp: Math.min(Math.max(targetTemp, ecoTemp), comfortTemp),
      reasoning: `${reason}: aktuelle Zieltemperatur ist im sicheren Bereich`,
      expected_energy_wh: 0,
      confidence: 0.7,
    };
  });

  return {
    decisions,
    overall_strategy: `${reason}: deterministische PV-/SOC-/Temperatur-Regeln aktiv, KI-Ausfall blockiert den Autopilot nicht.`,
  };
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

      // Vorausschau: Wann beginnen/enden die nächsten Peak-Stunden?
      let preheatingAdvice = '';
      if (hourlyWatts && peakHours.length > 0) {
        const now = new Date();
        const currentHour = parseInt(now.toLocaleTimeString('de-DE', {
          timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false
        }));

        const nextPeakHour = Object.entries(hourlyWatts)
          .map(([time, watts]) => {
            const h = parseInt((time.includes(' ') ? time.split(' ')[1] : time).split(':')[0]);
            return { hour: h, watts: watts as number };
          })
          .filter(e => e.hour > currentHour && e.watts > 3000)
          .sort((a, b) => a.hour - b.hour)[0];

        const currentPvWatts = (hourlyWatts as any)[`${currentHour}:00`] ||
          (hourlyWatts as any)[`${String(currentHour).padStart(2,'0')}:00`] || 0;

        if (nextPeakHour && nextPeakHour.hour - currentHour <= 2 && currentPvWatts < 2000) {
          const minutesToPeak = (nextPeakHour.hour - currentHour) * 60;
          preheatingAdvice = `⚡ VORHEIZ-EMPFEHLUNG: Peak (${nextPeakHour.watts}W) beginnt in ~${minutesToPeak} Minuten (${nextPeakHour.hour}:00). ` +
            `Räume mit hohem Wärmeverlust jetzt auf Eco vorheizen, damit beim PV-Peak nur noch Comfort-Erhalt nötig ist.`;
        } else if (pvPower > 3000 && peakHours.length > 0) {
          const peakEndHour = parseInt(peakHours[peakHours.length - 1].split(':')[0]);
          if (peakEndHour - currentHour <= 1) {
            preheatingAdvice = `⏰ PEAK ENDET in ~${(peakEndHour - currentHour) * 60} Minuten. ` +
              `Jetzt alle Räume auf maximale Comfort-Temp bringen um Wärme zu speichern.`;
          }
        }
      }

      // Strukturiertes Pre-Heat-Signal in system_settings persistieren,
      // damit pv-automation es konsumieren kann (TTL-Check via computed_at).
      try {
        const signalType = preheatingAdvice.startsWith('⚡') ? 'preheat'
          : preheatingAdvice.startsWith('⏰') ? 'store_heat'
          : 'none';
        const nextPeakHourCalc = Object.entries(hourlyWatts || {})
          .map(([time, watts]) => {
            const h = parseInt((time.includes(' ') ? time.split(' ')[1] : time).split(':')[0]);
            return { hour: h, watts: watts as number };
          })
          .filter(e => {
            const ch = parseInt(new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
            return e.hour > ch && e.watts > 3000;
          })
          .sort((a, b) => a.hour - b.hour)[0];
        const nowVienna = new Date();
        const ch = parseInt(nowVienna.toLocaleTimeString('de-DE', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
        const payload = {
          key: 'preheating_signal',
          value: {
            computed_at: new Date().toISOString(),
            type: signalType,
            target_peak_hour: nextPeakHourCalc?.hour ?? null,
            minutes_to_peak: nextPeakHourCalc ? (nextPeakHourCalc.hour - ch) * 60 : null,
            expected_peak_w: nextPeakHourCalc?.watts ?? null,
            advice_text: preheatingAdvice || '',
          },
          updated_at: new Date().toISOString(),
        };
        await fetch(`${supabaseUrl}/rest/v1/system_settings?on_conflict=key`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.warn('[analyze-patterns] could not upsert preheating_signal:', e);
      }

       prompt = `Du bist ein ML-basiertes Heizungsoptimierungssystem. Dein Ziel ist es, Energie zu sparen und Komfort zu gewährleisten.

⚠️ **WICHTIG: ALLE ERFORDERLICHEN DATEN SIND UNTEN AUFGEFÜHRT. GIB NUR KONKRETE EMPFEHLUNGEN, KEINE RÜCKFRAGEN!**

**HARDWARE-FAKTEN (NICHT VERHANDELBAR):**
- Die Batterie wird AUSSCHLIESSLICH vom Smartfox/Fronius-Wechselrichter gesteuert. Die Software kann das LADEN der Batterie NICHT beeinflussen. Es gibt KEINE Ladeobergrenze und KEINE Einstellung wie "Batterie nur bis X% laden, Rest in Heizung". Schlage so etwas NIEMALS vor.
- Warmwasser wird autonom von Smartfox gesteuert.

**SEMANTIK heating_min_battery_soc (KRITISCH):**
- Das ist eine UNTERGRENZE (Floor) für die Heizungs-Nutzung der Batterie, KEINE Obergrenze.
- Nur der SOC-Anteil OBERHALB dieses Werts darf für Komfort-Heizung verbraucht werden. Sobald SOC darunter fällt → Komfort-Hard-Lock (comfortBudget = 0, Eco bleibt erlaubt).
- Beispiel: Wert 90% → obersten 10% der Batterie für Heizung frei, 90% Reserve.
- Höherer Wert = mehr Reserve, weniger Heizung-Budget. Niedrigerer Wert = umgekehrt.

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
${preheatingAdvice ? '\n**' + preheatingAdvice + '**\n' : ''}

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
- Heiz-Min-SOC: ${heatingSettings?.heating_min_battery_soc || 80}%, PV-Schwelle EIN: ${heatingSettings?.pv_surplus_threshold_on || 500}W, AUS: ${heatingSettings?.pv_surplus_threshold_off || 200}W

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

      const heatingTypeRaw = heatingSettings?.heating_type || 'direct_electric';
      const heatingTypeLabels: Record<string, string> = {
        'direct_electric': 'Direkte elektrische Fußbodenheizung (Stromdirektheizung)',
        'heat_pump': 'Wärmepumpe',
        'water': 'Wasserbasierte Heizung'
      };
      const heatingTypeLabel = heatingTypeLabels[heatingTypeRaw] || 'Stromdirektheizung';

      // Tool-Calling für strukturiertes weekly_insight
      useToolCalling = true;
      toolName = 'weekly_insight';
      toolDefinition = {
        type: 'function',
        function: {
          name: 'weekly_insight',
          description: 'Strukturierte Wochenanalyse für PV-Optimierung',
          parameters: {
            type: 'object',
            properties: {
              trend: { type: 'string', enum: ['improving', 'stable', 'worsening'] },
              avg_self_consumption_ratio: { type: 'number', description: '0..1, PV selbst genutzt / PV produziert' },
              top_grid_import_hours: {
                type: 'array',
                items: { type: 'integer', minimum: 0, maximum: 23 },
                description: 'Stunden (0-23) mit höchstem Netzbezug diese Woche'
              },
              recommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    value: {},
                    reason: { type: 'string' }
                  },
                  required: ['key', 'value', 'reason']
                }
              },
              summary: { type: 'string' }
            },
            required: ['trend', 'avg_self_consumption_ratio', 'top_grid_import_hours', 'recommendations', 'summary']
          }
        }
      };

      const dateRange = readings.length > 0
        ? `${readings[readings.length - 1].date} bis ${readings[0].date}`
        : 'unbekannt';

      prompt = `Wochenvergleich (${dateRange}):

**HEIZUNGSANLAGE:** ${heatingTypeLabel}
**Verbraucher:** Heizung ${totalHeatingPower}W, Warmwasser ${heatingSettings?.hotwater_power_w || 6000}W
**Batterie:** ${heatingSettings?.battery_capacity_kwh || 13.8}kWh, Heiz-Min-SoC ${heatingSettings?.heating_min_battery_soc || 80}%

**Tagesdaten (live aggregiert):**
${readings.map((r: Record<string, unknown>) => `${r.date}: Peak ${Math.round(Number(r.peak_power))}W, Avg ${Math.round(Number(r.avg_power))}W, Bezug ${Number(r.energy_in_kwh).toFixed(1)}kWh, Einsp. ${Number(r.energy_out_kwh).toFixed(1)}kWh, PV ${Number(r.pv_kwh).toFixed(1)}kWh, Heizung ${Number(r.heating_kwh).toFixed(1)}kWh${r.avg_outdoor_c != null ? `, Außen ${Number(r.avg_outdoor_c).toFixed(1)}°C` : ''}`).join('\n')}

Analysiere Trends (Eigenverbrauchsquote, Netzbezugs-Spitzen-Stunden, Heizeffizienz vs Außentemp). Gib konkrete Optimierungsempfehlungen für die PV-Heizungssteuerung. Antworte via Tool-Call.`;

    } else if (type === 'match_today') {
      // Heutige Signatur berechnen und Top-Treffer + Empfehlungen persistieren
      try {
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
        // Forecast & Wetter laden
        const fcRes = await fetch(`${supabaseUrl}/rest/v1/pv_forecasts?date=eq.${todayStr}&select=expected_kwh`, {
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        });
        const fc = await fcRes.json();
        const expected_pv_kwh = Number(fc?.[0]?.expected_kwh ?? 0);
        const wRes = await fetch(`${supabaseUrl}/rest/v1/weather_data?timestamp=gte.${todayStr}T00:00:00&order=timestamp.desc&limit=1&select=temperature_c`, {
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        });
        const w = await wRes.json();
        const tempC = w?.[0]?.temperature_c == null ? null : Number(w[0].temperature_c);

        const sig_pv_bucket = expected_pv_kwh < 30 ? 'low' : expected_pv_kwh < 60 ? 'mid' : 'high';
        const sig_temp_bucket = tempC == null ? 'mild' : tempC < 5 ? 'cold' : tempC < 15 ? 'mild' : 'warm';
        const sig_weather = expected_pv_kwh >= 50 ? 'sunny' : expected_pv_kwh >= 25 ? 'mixed' : 'cloudy';
        const dow = new Date().getUTCDay();
        const sig_weekday = (dow === 0 || dow === 6) ? 'weekend' : 'workday';
        const signature = { sig_weather, sig_pv_bucket, sig_temp_bucket, sig_weekday };

        const matchRes = await fetch(`${supabaseUrl}/rest/v1/rpc/match_today_pattern`, {
          method: 'POST',
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ today_signature: signature, top_n: 3 }),
        });
        const matches = await matchRes.json();
        const top = Array.isArray(matches) && matches.length > 0 ? matches[0] : null;

        const payload = {
          key: 'best_match_today',
          value: {
            computed_at: new Date().toISOString(),
            signature,
            top_days: matches ?? [],
            match_quality: top?.match_quality ?? 'none',
            recommended_overrides: top?.settings_snapshot ?? null,
          },
          updated_at: new Date().toISOString(),
        };
        await fetch(`${supabaseUrl}/rest/v1/system_settings?on_conflict=key`, {
          method: 'POST',
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(payload),
        });

        return new Response(JSON.stringify({ ok: true, signature, matches }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

    } else if (type === 'weekly_comparison_auto') {
      // Auto-Variante: lädt Daten selbst und delegiert an weekly_comparison
      const wkRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_weekly_energy_summary`, {
        method: 'POST',
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ days_back: 7 }),
      });
      const wk = await wkRes.json();
      const validDays = (Array.isArray(wk) ? wk : []).filter((d: any) => (d.reading_count ?? 0) > 0);
      if (validDays.length < 2) {
        return new Response(JSON.stringify({ ok: false, reason: 'not enough data' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // re-call self synchron mit type='weekly_comparison'
      const recurse = await fetch(`${supabaseUrl}/functions/v1/analyze-patterns`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'weekly_comparison', readings: validDays, heatingSettings: heatingSettings ?? {}, rooms: rooms ?? [] }),
      });
      return new Response(await recurse.text(), { status: recurse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (type === 'monthly_pattern') {
      // Aggregiere daily_pattern_scores der letzten 30 Tage je Signatur
      const sinceDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const dpsRes = await fetch(`${supabaseUrl}/rest/v1/daily_pattern_scores?date=gte.${sinceDate}&select=*&order=date.desc`, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      const dps: any[] = await dpsRes.json();
      if (!Array.isArray(dps) || dps.length < 21) {
        const payload = {
          key: 'monthly_playbook',
          value: { computed_at: new Date().toISOString(), insufficient_data: true, sample_size: dps?.length ?? 0, playbook: [] },
          updated_at: new Date().toISOString(),
        };
        await fetch(`${supabaseUrl}/rest/v1/system_settings?on_conflict=key`, {
          method: 'POST',
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(payload),
        });
        return new Response(JSON.stringify({ ok: true, insufficient_data: true, sample_size: dps?.length ?? 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const groups: Record<string, any[]> = {};
      for (const r of dps) {
        const k = `${r.sig_weather}|${r.sig_pv_bucket}|${r.sig_temp_bucket}|${r.sig_weekday}`;
        (groups[k] ||= []).push(r);
      }
      const playbook = Object.entries(groups).map(([k, rows]) => {
        rows.sort((a, b) => Number(b.score) - Number(a.score));
        const best = rows[0];
        const [sw, spv, st, swd] = k.split('|');
        return {
          signature: { sig_weather: sw, sig_pv_bucket: spv, sig_temp_bucket: st, sig_weekday: swd },
          sample_size: rows.length,
          avg_score: rows.reduce((s, r) => s + Number(r.score || 0), 0) / rows.length,
          best_day: best.date,
          best_score: Number(best.score),
          recommended_overrides: best.settings_snapshot ?? {},
        };
      }).sort((a, b) => b.avg_score - a.avg_score);

      const payload = {
        key: 'monthly_playbook',
        value: { computed_at: new Date().toISOString(), sample_size: dps.length, playbook },
        updated_at: new Date().toISOString(),
      };
      await fetch(`${supabaseUrl}/rest/v1/system_settings?on_conflict=key`, {
        method: 'POST',
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });
      return new Response(JSON.stringify({ ok: true, sample_size: dps.length, signatures: playbook.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else {
      prompt = `Aktueller Energiestatus:
Leistung: ${readings?.power_io}W, Import: ${readings?.energy_in}kWh, Export: ${readings?.energy_out}kWh
Kurze Einschätzung auf Deutsch.`;
    }

    const aiRequestBody: AIRequestBody = {
      model: type === 'optimize_decision' ? 'google/gemini-2.5-flash-lite' : 'google/gemini-2.5-flash',
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
      
      if (type === 'optimize_decision') {
        const fallback = buildDeterministicHeatingDecision({ readings, rooms, heatingSettings }, aiResponse.status === 429 ? 'KI-Rate-Limit' : 'KI-Fallback');
        return new Response(JSON.stringify({ ...fallback, fallback: true, error: aiResponse.error }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (aiResponse.status === 429) {
        // Soft-fail: return 200 so callers (UI + pv-automation) don't break / blank-screen.
        // The deterministic budget logic is the final filter anyway.
        return new Response(
          JSON.stringify({
            error: 'Rate limit',
            rateLimited: true,
            decisions: [],
            analysis: 'KI-Analyse aktuell rate-limited (Gemini Free Tier). Bitte später erneut versuchen.',
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
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
          } else if (toolName === 'weekly_insight') {
            // Persistiere strukturierte Wocheneinsichten für pv-automation
            try {
              await fetch(`${supabaseUrl}/rest/v1/system_settings?on_conflict=key`, {
                method: 'POST',
                headers: {
                  apikey: serviceRoleKey,
                  Authorization: `Bearer ${serviceRoleKey}`,
                  'Content-Type': 'application/json',
                  Prefer: 'resolution=merge-duplicates,return=minimal',
                },
                body: JSON.stringify({
                  key: 'weekly_insight',
                  value: { ...result, computed_at: new Date().toISOString() },
                  updated_at: new Date().toISOString(),
                }),
              });
            } catch (e) {
              console.warn('[analyze-patterns] could not upsert weekly_insight:', e);
            }
            const formatted = `**Trend:** ${result.trend}\n**Eigenverbrauch:** ${Math.round((result.avg_self_consumption_ratio || 0) * 100)}%\n**Spitzenstunden Netzbezug:** ${(result.top_grid_import_hours || []).join(', ')}h\n\n${result.summary || ''}\n\n**Empfehlungen:**\n${(result.recommendations || []).map((r: any) => `- ${r.key}=${JSON.stringify(r.value)}: ${r.reason}`).join('\n')}`;
            return new Response(JSON.stringify({ analysis: formatted, weeklyInsight: result }), {
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
