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
    const { readings, heatingSettings, rooms, consumerLogs, type } = await req.json();
    
    console.log(`Analyzing type: ${type}, readings: ${readings?.length || 0}, rooms: ${rooms?.length || 0}, consumerLogs: ${consumerLogs?.length || 0}`);
    
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
        `Heizleistung: ${r.heating_power_w || 800}W, ` +
        `Sonneneinstrahlung: ${r.has_solar_gain ? 'Ja' : 'Nein'}, ` +
        `Priorität: ${r.priority}, Komfort: ${r.comfort_temp}°C, Eco: ${r.eco_temp}°C, Nacht: ${r.night_temp}°C`
      ).join('\n');

      // Heizungstyp-Information berechnen
      const heatingType = heatingSettings?.heating_type || 'direct_electric';
      const totalInstalledPower = heatingSettings?.total_heating_power_w || 
        rooms.reduce((sum: number, r: any) => sum + (r.heating_power_w || 800), 0);
      const activeHeatingPower = rooms
        .filter((r: any) => r.is_heating)
        .reduce((sum: number, r: any) => sum + (r.heating_power_w || 800), 0);
      const nightCyclingEnabled = heatingSettings?.night_cycling_enabled !== false;
      const avgNightCycles = heatingSettings?.avg_night_cycles_per_room || 4;
      const maxNightPeak = totalInstalledPower * 0.6; // Annahme: max 60% gleichzeitig aktiv

      const heatingTypeInfo = heatingType === 'direct_electric' ? `
**WICHTIG - Heizungstyp: Direkte elektrische Fußbodenheizung**
- KEIN Wasser, KEINE Wärmepumpe - direkter Stromverbrauch aus Netz/Batterie!
- Gesamte installierte Heizleistung: ${totalInstalledPower}W (${(totalInstalledPower / 1000).toFixed(1)} kW)
- Aktuell aktive Heizleistung: ${activeHeatingPower}W
- Thermostate: TGP508 WiFi (6 Zeitperioden programmierbar)

**Nacht-Verhalten (erklärt Verbrauchsspitzen):**
${nightCyclingEnabled ? `- Thermostate takten nachts (An/Aus-Zyklen zur Temperaturregelung)
- Durchschnittlich ${avgNightCycles} Zyklen pro Raum pro Nacht
- Jeder Heizzyklus erzeugt Verbrauchsspitze entsprechend der Raumleistung
- Maximale nächtliche Spitzenlast: bis zu ${Math.round(maxNightPeak)}W` : '- Nacht-Taktung deaktiviert'}

**Optimierungshinweise für Direkt-Strom-Heizung:**
1. Estrich als Wärmespeicher: Tagsüber bei PV-Überschuss aufheizen
2. Nachts nur Erhaltungsheizung: Wärme im Estrich hält mehrere Stunden
3. Batterie für Nacht-Heizzyklen reservieren
4. Bei niedrigem SOC: Thermostate auf Nacht-Temp setzen, um Zyklen zu minimieren
` : '';

      const heatingPumpInfo = heatingType === 'heat_pump' ? `
**Heizungstyp: Wärmepumpe**
- Effizienter als Direktheizung (COP-Faktor beachten)
- Stromverbrauch ca. 1/3 der Heizleistung
` : '';

      const waterHeatingInfo = heatingType === 'water' ? `
**Heizungstyp: Wasserbasierte Fußbodenheizung**
- Wird über externen Kessel oder Wärmepumpe beheizt
- Kein direkter Stromverbrauch für Heizung
` : '';

      // Hotwater configuration
      const hotwaterEnabled = heatingSettings?.hotwater_enabled !== false;
      const hotwaterPower = heatingSettings?.hotwater_power_w || 2800;
      const hotwaterStart = heatingSettings?.hotwater_schedule_start || '10:00';
      const hotwaterEnd = heatingSettings?.hotwater_schedule_end || '16:00';
      const hotwaterMinSurplus = heatingSettings?.hotwater_min_surplus_w || 1000;

      const hotwaterInfo = hotwaterEnabled ? `
**Warmwasser-Bereitung (Smartfox-gesteuert):**
- Heizstab-Leistung: ${hotwaterPower}W
- Schaltzeit: ${hotwaterStart} - ${hotwaterEnd} Uhr
- Aktivierung ab: ${hotwaterMinSurplus}W PV-Überschuss
- WICHTIG: Während der Warmwasser-Schaltzeit wird bis zu ${hotwaterPower}W PV-Überschuss für Warmwasser verbraucht!
- Die effektive verfügbare Leistung für Heizung ist entsprechend reduziert.
` : '';

      // E-Auto und andere Großverbraucher-Info für Raumanalyse
      let roomConsumerInfo = '';
      if (consumerLogs && consumerLogs.length > 0) {
        const carLogs = consumerLogs.filter((c: any) => c.consumer_type === 'car');
        const hotwaterLogs = consumerLogs.filter((c: any) => c.consumer_type === 'hotwater');
        
        if (carLogs.length > 0) {
          roomConsumerInfo += `\n**E-Auto Ladevorgänge heute (NICHT Heizung!):**\n`;
          carLogs.forEach((log: any) => {
            const start = new Date(log.start_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const end = log.end_time ? new Date(log.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'läuft noch';
            const energy = log.total_energy_wh ? `${(log.total_energy_wh / 1000).toFixed(1)} kWh` : 'aktiv';
            roomConsumerInfo += `- ${start} - ${end}: ~${Math.round((log.avg_power_w || 0) / 1000)} kW, ${energy}\n`;
          });
        }
        
        if (hotwaterLogs.length > 0) {
          roomConsumerInfo += `\n**Warmwasser-Bereitung heute:**\n`;
          hotwaterLogs.forEach((log: any) => {
            const start = new Date(log.start_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const end = log.end_time ? new Date(log.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'läuft noch';
            roomConsumerInfo += `- ${start} - ${end}: ~${Math.round((log.avg_power_w || 0) / 1000)} kW\n`;
          });
        }
        
        if (roomConsumerInfo) {
          roomConsumerInfo += `
**WICHTIG - Verbrauchsbereinigung:**
E-Auto und Warmwasser sind KEINE Heizung! Ziehe diese von den stündlichen Werten ab.
Bereinigter Heizungsbedarf = Gesamtverbrauch - E-Auto - Warmwasser
`;
        }
      }

      prompt = `Du bist ein Experte für Energiemanagement und Fußbodenheizung mit PV und Batterie.

Erstelle RAUMSPEZIFISCHE Heizempfehlungen für jeden Raum basierend auf:
${heatingTypeInfo}${heatingPumpInfo}${waterHeatingInfo}
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
${roomConsumerInfo}
${hotwaterInfo}
**Räume im Haushalt:**
${roomsList}

**Optimierungsregeln:**
1. **Südräume mit Sonneneinstrahlung zuerst heizen** bei PV-Überschuss - kostenlose Solarwärme + PV-Strom
2. **Nordzimmer verzögern** bis Batterie ausreichend geladen (>${heatingSettings?.target_battery_soc || 80}%)
3. **Priorität beachten**: Priorität 1 = wichtig (z.B. Wohnzimmer), Priorität 3 = weniger wichtig (z.B. Gästezimmer)
4. **Bei niedrigem SOC (<${heatingSettings?.min_battery_soc || 20}%)**: Nur Priorität 1 Räume heizen
5. **Estrich als Wärmespeicher**: Räume bei PV-Überschuss über Komfort-Temp aufheizen (max +2°C)
6. **Nachtabsenkung**: Alle Räume auf Nacht-Temp ab 22:00
${hotwaterEnabled ? `7. **Warmwasser berücksichtigen**: Zwischen ${hotwaterStart} und ${hotwaterEnd} steht weniger PV für Heizung zur Verfügung (bis zu ${hotwaterPower}W werden für Warmwasser genutzt)` : ''}

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

      // Hotwater configuration for global heating plan
      const hotwaterEnabled = heatingSettings?.hotwater_enabled !== false;
      const hotwaterPower = heatingSettings?.hotwater_power_w || 2800;
      const hotwaterStart = heatingSettings?.hotwater_schedule_start || '10:00';
      const hotwaterEnd = heatingSettings?.hotwater_schedule_end || '16:00';
      const hotwaterMinSurplus = heatingSettings?.hotwater_min_surplus_w || 1000;

      const hotwaterInfo = hotwaterEnabled ? `
**Warmwasser-Bereitung (Smartfox-gesteuert):**
- Heizstab-Leistung: ${hotwaterPower}W
- Schaltzeit: ${hotwaterStart} - ${hotwaterEnd} Uhr
- Aktivierung ab: ${hotwaterMinSurplus}W PV-Überschuss
- WICHTIG: Während der Warmwasser-Schaltzeit (${hotwaterStart}-${hotwaterEnd}) wird PV-Überschuss primär für Warmwasser genutzt!
` : '';

      // E-Auto und andere Großverbraucher-Info
      let consumerInfo = '';
      if (consumerLogs && consumerLogs.length > 0) {
        const carLogs = consumerLogs.filter((c: any) => c.consumer_type === 'car');
        const hotwaterLogs = consumerLogs.filter((c: any) => c.consumer_type === 'hotwater');
        const heatingLogs = consumerLogs.filter((c: any) => c.consumer_type === 'heating');
        
        if (carLogs.length > 0) {
          consumerInfo += `\n**E-Auto Ladevorgänge heute (NICHT Heizung!):**\n`;
          carLogs.forEach((log: any) => {
            const start = new Date(log.start_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const end = log.end_time ? new Date(log.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'läuft noch';
            const energy = log.total_energy_wh ? `${(log.total_energy_wh / 1000).toFixed(1)} kWh` : 'aktiv';
            consumerInfo += `- ${start} - ${end}: ~${Math.round((log.avg_power_w || 0) / 1000)} kW, ${energy}\n`;
          });
        }
        
        if (hotwaterLogs.length > 0) {
          consumerInfo += `\n**Warmwasser-Bereitung heute:**\n`;
          hotwaterLogs.forEach((log: any) => {
            const start = new Date(log.start_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const end = log.end_time ? new Date(log.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'läuft noch';
            consumerInfo += `- ${start} - ${end}: ~${Math.round((log.avg_power_w || 0) / 1000)} kW\n`;
          });
        }
        
        if (heatingLogs.length > 0) {
          consumerInfo += `\n**Heizungsaktivität heute:**\n`;
          heatingLogs.forEach((log: any) => {
            const start = new Date(log.start_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const end = log.end_time ? new Date(log.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'läuft noch';
            consumerInfo += `- ${start} - ${end}: ~${Math.round((log.avg_power_w || 0) / 1000)} kW\n`;
          });
        }
        
        if (consumerInfo) {
          consumerInfo += `
**WICHTIG - Verbrauchsbereinigung:**
Die oben genannten Verbraucher sind KEINE Heizung! Ziehe diese Verbräuche von den stündlichen Durchschnittswerten ab:
- E-Auto: Typisch 11 kW (3-phasig) oder 3.7 kW (1-phasig)
- Warmwasser: ~${hotwaterPower}W während Schaltzeit
Bereinigter Heizungsbedarf = Gesamtverbrauch - E-Auto - Warmwasser
`;
        }
      }

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
${consumerInfo}
${hotwaterInfo}
**Optimierungsziele:**
1. Estrich als Wärmespeicher nutzen (Vorheizen bei PV-Überschuss)
2. Batterie für Abend/Nacht priorisieren (erst laden, dann heizen)
3. Heizung bei niedrigem SOC reduzieren
4. Nachtabsenkung nutzen (Wärme im Estrich hält)
${hotwaterEnabled ? `5. Warmwasser berücksichtigen: Zwischen ${hotwaterStart}-${hotwaterEnd} ist weniger PV für Heizung verfügbar` : ''}

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
      // Verbraucher-Informationen aufbereiten
      const heatingType = heatingSettings?.heating_type || 'direct_electric';
      const totalHeatingPower = rooms?.reduce((sum: number, r: any) => sum + (r.heating_power_w || 800), 0) || 0;
      const hotwaterPower = heatingSettings?.hotwater_power_w || 6000;
      const hotwaterStart = heatingSettings?.hotwater_schedule_start || '12:00';
      const hotwaterEnd = heatingSettings?.hotwater_schedule_end || '16:00';
      const hotwaterMinSurplus = heatingSettings?.hotwater_min_surplus_w || 1000;
      const carEnabled = heatingSettings?.car_charging_enabled;
      
      const roomsList = rooms?.map((r: any) => `${r.name} (${r.heating_power_w || 800}W)`).join(', ') || 'Keine Räume definiert';
      
      // Consumer-Logs aufbereiten
      let consumerActivity = '';
      if (consumerLogs && consumerLogs.length > 0) {
        consumerActivity = '\n**HEUTIGE VERBRAUCHER-AKTIVITÄT:**\n';
        consumerLogs.forEach((log: any) => {
          const start = new Date(log.start_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
          const end = log.end_time ? new Date(log.end_time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'aktiv';
          const avgPower = Math.round(log.avg_power_w || 0);
          consumerActivity += `- ${log.consumer_type}: ${start} - ${end}, ~${avgPower}W\n`;
        });
      }

      prompt = `Du bist ein Experte für Energiemanagement mit DETAILLIERTEM Wissen über diesen Haushalt.

**BEKANNTE VERBRAUCHER IM HAUSHALT:**

1. **Elektrische Fußbodenheizung** (${heatingType === 'direct_electric' ? 'Direkt-Strom' : heatingType}):
   - Gesamtleistung installiert: ${totalHeatingPower}W (${(totalHeatingPower / 1000).toFixed(1)} kW)
   - Räume: ${roomsList}
   - Nachts takten Thermostate (An/Aus-Zyklen zur Temperaturregelung)
   - Typische Nacht-Spitzen: 3-7 kW wenn mehrere Räume gleichzeitig heizen

2. **Warmwasser-Bereitung** (Smartfox-gesteuert):
   - Heizstab-Leistung: ${hotwaterPower}W (${(hotwaterPower / 1000).toFixed(1)} kW)
   - Schaltzeit: ${hotwaterStart} - ${hotwaterEnd} Uhr
   - Aktivierung ab: ${hotwaterMinSurplus}W PV-Überschuss

3. **E-Auto Ladestation**:
   - Typische Ladeleistung: 3.7kW (1-phasig) oder 11kW (3-phasig)
   ${carEnabled ? '- E-Auto-Laden ist aktiviert' : '- Aktuell deaktiviert'}
${consumerActivity}
**WICHTIG - ANALYSEANWEISUNGEN:**
- Ordne Verbrauchsspitzen den BEKANNTEN Verbrauchern zu!
- Nächtliche Spitzen (3-7kW) sind typischerweise Heizungs-Taktzyklen der Fußbodenheizung
- Verbrauch zwischen ${hotwaterStart}-${hotwaterEnd} kann Warmwasser-Bereitung sein
- Spekuliere NICHT über unbekannte Verbraucher wenn bekannte Verbraucher die Werte erklären!

**ENERGIEDATEN ZU ANALYSIEREN:**
${readings.map((r: any) => `${r.timestamp}: ${r.power_io}W, PV: ${r.pv_power || 0}W, Batterie: ${r.battery_soc || 0}%`).join('\n')}

Analysiere die Daten und:
1. Ordne Verbrauchsspitzen konkret den BEKANNTEN Verbrauchern zu (Heizung, Warmwasser, E-Auto)
2. Erkläre typische Muster (z.B. Heizungs-Taktzyklen nachts, Warmwasser mittags)
3. Identifiziere nur WIRKLICH unerklärten Verbrauch der nicht zu den bekannten Verbrauchern passt
4. Gib konkrete Optimierungsvorschläge basierend auf dem Haushaltsprofil

Antworte auf Deutsch mit konkreten Uhrzeiten und klaren Zuordnungen.`;

    } else if (type === 'weekly_comparison') {
      // Verbraucher-Kontext für Wochenvergleich
      const heatingType = heatingSettings?.heating_type || 'direct_electric';
      const totalHeatingPower = rooms?.reduce((sum: number, r: any) => sum + (r.heating_power_w || 800), 0) || 0;
      const roomsList = rooms?.map((r: any) => `${r.name} (${r.heating_power_w || 800}W)`).join(', ') || 'Keine Räume';

      prompt = `Du bist ein Experte für Energiemanagement mit DETAILLIERTEM Wissen über diesen Haushalt.

**BEKANNTE VERBRAUCHER:**
- Elektrische Fußbodenheizung (${heatingType}): ${totalHeatingPower}W gesamt
- Räume: ${roomsList}
- Warmwasser: ${heatingSettings?.hotwater_power_w || 6000}W Heizstab
- E-Auto: ${heatingSettings?.car_charging_enabled ? 'aktiviert' : 'deaktiviert'}

**WOCHENDATEN:**
${readings.map((r: any) => `${r.date}: Peak: ${r.peak_power}W, Durchschnitt: ${r.avg_power}W, Import: ${r.total_energy_in}kWh, Export: ${r.total_energy_out}kWh`).join('\n')}

Analysiere unter Berücksichtigung der bekannten Verbraucher:
1. Unterschiede zwischen Wochentagen und Wochenende (Heizverhalten, Anwesenheit)
2. Trends über die Woche (Wetter-Einfluss auf Heizung?)
3. Beste und schlechteste Tage für Eigenverbrauch
4. Konkrete Optimierungsempfehlungen für diesen Haushalt

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
