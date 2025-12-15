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
    const { readings, type } = await req.json();
    
    console.log(`Analyzing ${readings?.length || 0} readings, type: ${type}`);
    
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    let prompt = '';
    
    if (type === 'daily_pattern') {
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

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'system', 
            content: 'Du bist ein Experte für Energiemanagement und Photovoltaik-Anlagen. Analysiere Energiedaten präzise und gib praktische Empfehlungen. Antworte immer auf Deutsch.' 
          },
          { role: 'user', content: prompt }
        ],
      }),
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
