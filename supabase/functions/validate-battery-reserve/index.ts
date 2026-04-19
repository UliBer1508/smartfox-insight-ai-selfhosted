// validate-battery-reserve
// Läuft täglich kurz nach 09:00 Europe/Vienna (via pg_cron).
// Prüft, ob die Batterie-Reserve (battery_reserve_for_night_soc) über Nacht gehalten wurde.
// Schreibt Status in system_settings.battery_reserve_validation und aktualisiert
// battery_daily_tracking mit Morgen-SOC + Nachtverbrauch.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Settings holen
    const { data: settings } = await supabase
      .from("heating_settings")
      .select("battery_reserve_for_night_soc")
      .limit(1)
      .maybeSingle();
    const reserveTarget = settings?.battery_reserve_for_night_soc ?? 60;

    // Datum: gestern + heute (Europe/Vienna)
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString("en-CA", { timeZone: "Europe/Vienna" });

    // Aktuellen SOC (=Morgen-SOC um 09:00)
    const { data: latest } = await supabase
      .from("energy_readings")
      .select("battery_soc, timestamp")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const morningSoc = latest?.battery_soc ?? null;

    // Nacht-Verbrauch berechnen (gestern 20:00 → heute 09:00 Wien)
    // Wien-Offset grob via Date – einfach absoluten Zeitraum nehmen
    const nightStart = new Date(`${yesterdayStr}T20:00:00+01:00`);
    const nightEnd = new Date(`${todayStr}T09:00:00+01:00`);
    const { data: nightReadings } = await supabase
      .from("energy_readings")
      .select("battery_soc, energy_in, timestamp")
      .gte("timestamp", nightStart.toISOString())
      .lte("timestamp", nightEnd.toISOString())
      .order("timestamp", { ascending: true });

    let minSocNight: number | null = null;
    let nightConsumptionKwh: number | null = null;
    if (nightReadings && nightReadings.length > 1) {
      minSocNight = Math.min(...nightReadings.map((r) => r.battery_soc ?? 100));
      const first = nightReadings[0];
      const last = nightReadings[nightReadings.length - 1];
      nightConsumptionKwh = Number(last.energy_in) - Number(first.energy_in);
    }

    // Tracking-Eintrag von gestern lesen für heating_battery_used
    const { data: yTrack } = await supabase
      .from("battery_daily_tracking")
      .select("soc_at_heating_start, soc_at_heating_end")
      .eq("date", yesterdayStr)
      .maybeSingle();

    let heatingBatteryUsedKwh: number | null = null;
    if (yTrack?.soc_at_heating_start && yTrack?.soc_at_heating_end) {
      // Differenz × Batterie-Kapazität (default 13.8) → grobe Schätzung
      const { data: hs } = await supabase
        .from("heating_settings")
        .select("battery_capacity_kwh")
        .limit(1)
        .maybeSingle();
      const cap = Number(hs?.battery_capacity_kwh ?? 13.8);
      const delta = Number(yTrack.soc_at_heating_start) - Number(yTrack.soc_at_heating_end);
      heatingBatteryUsedKwh = Math.round((delta / 100) * cap * 100) / 100;
    }

    // Eintrag für gestern aktualisieren (Morgen-SOC ist *heute morgen*, betrifft also gestriges Tracking)
    await supabase.from("battery_daily_tracking").upsert({
      date: yesterdayStr,
      soc_at_morning: morningSoc,
      min_soc_during_night: minSocNight,
      night_consumption_kwh: nightConsumptionKwh,
      heating_battery_used_kwh: heatingBatteryUsedKwh,
    }, { onConflict: "date" });

    // Validierung
    const reserveHeld = morningSoc !== null && morningSoc >= reserveTarget - 5;
    let suggestion = "ok";
    if (morningSoc !== null && morningSoc < reserveTarget - 10) {
      suggestion = `increase_reserve_to_${Math.min(80, reserveTarget + 5)}`;
    } else if (morningSoc !== null && morningSoc > reserveTarget + 15) {
      suggestion = `decrease_reserve_to_${Math.max(40, reserveTarget - 5)}`;
    }

    const validation = {
      last_check: new Date().toISOString(),
      checked_date: yesterdayStr,
      reserve_held: reserveHeld,
      actual_morning_soc: morningSoc,
      min_soc_during_night: minSocNight,
      target_reserve: reserveTarget,
      night_consumption_kwh: nightConsumptionKwh,
      heating_battery_used_kwh: heatingBatteryUsedKwh,
      suggestion,
    };

    await supabase.from("system_settings").upsert({
      key: "battery_reserve_validation",
      value: validation,
    }, { onConflict: "key" });

    console.log("[validate-battery-reserve]", JSON.stringify(validation));
    return new Response(JSON.stringify({ success: true, validation }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[validate-battery-reserve] error:", e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
