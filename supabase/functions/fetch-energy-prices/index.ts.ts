// Edge Function: fetch-energy-prices
// Beide Preise sind feste Vertrags-/Richtwerte (kein Scraping mehr).
// - Salzburg AG: Bezugspreis (was eine Netz-kWh kostet), Jahreswert.
// - ÖMAG: Einspeise-/Marktpreis (PV-Überschuss-Verkauf), als Richtwert.
// Bei Abweichung zum aktuell gültigen Wert wird ein price_suggestions-Eintrag
// angelegt (kein Auto-Apply — Bestätigung erfolgt im Dashboard).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface FetchResult {
  source: "salzburg_ag" | "oemag";
  field: "electricity_price_cent" | "feed_in_price_cent" | "electricity_base_fee_year_eur";
  value: number;
  excerpt: string;
}

// --- ÖMAG (Einspeise-/Marktpreis für PV-Überschuss) ---
// Fester Richtwert statt Scraping. Grund: ÖMAG veröffentlicht den Marktpreis
// seit 2024 MONATLICH und rückwirkend in einer Tabelle (nicht mehr als einzelner
// Quartalssatz). Der alte Scraper suchte ein "Marktpreis ... ct/kWh"-Muster,
// das es so nicht mehr gibt → still gebrochen. Für die Heizentscheidung ist der
// exakte Wert zweitrangig (Bezugspreis ~30 ct >> Einspeisung ~6,8 ct → Selbst-
// verbrauch/Heizen gewinnt praktisch immer). 6,772 ct = stabiler Wert der
// letzten Monate (April/Mai/Juni 2026, Photovoltaik).
// Bei Bedarf halbjährlich prüfen: oem-ag.at/de/marktpreis/ → nur die Zahl anpassen.
async function fetchOemag(): Promise<FetchResult[]> {
  const OEMAG_PV = {
    marktpreis_cent: 6.772,          // ct/kWh, Photovoltaik (Durchschnitt 2026)
    stand: "Richtwert 2026 (ÖMAG Marktpreis PV, monatlich rückwirkend)",
  };

  return [
    {
      source: "oemag",
      field: "feed_in_price_cent",
      value: OEMAG_PV.marktpreis_cent,
      excerpt: `ÖMAG Marktpreis Photovoltaik ${OEMAG_PV.marktpreis_cent} ct/kWh (${OEMAG_PV.stand})`,
    },
  ];
}

// --- Salzburg AG (Strom Privat 24) ---
// Fester Vertragspreis statt Scraping. Grund: Salzburg AG hat die Tarifseite
// umgebaut (404), der Preis ist ein Jahreswert (gültig ab 1.1.2026) und ändert
// sich nur 1-2x/Jahr. Werte aus dem offiziellen Produktblatt "Stromtarife für
// Privatkund:innen", Tarif "Strom Privat 24", GESAMTPREIS brutto (inkl. Netz,
// Abgaben, Steuern) — das ist der real ersparte Preis pro selbst erzeugter kWh.
// Bei Preisänderung: nur die beiden Zahlen hier anpassen + neu deployen.
async function fetchSalzburgAg(): Promise<FetchResult[]> {
  const STROM_PRIVAT_24 = {
    arbeitspreis_cent_brutto: 29.9351,      // Gesamtpreis Arbeitspreis ct/kWh brutto
    grundentgelt_eur_jahr_brutto: 128.1792, // Gesamtpreis Grundentgelt €/Jahr brutto
    stand: "gültig ab 1.1.2026 (Produktblatt Salzburg AG)",
  };

  return [
    {
      source: "salzburg_ag",
      field: "electricity_price_cent",
      value: STROM_PRIVAT_24.arbeitspreis_cent_brutto,
      excerpt: `Strom Privat 24, Gesamtpreis Arbeitspreis ${STROM_PRIVAT_24.arbeitspreis_cent_brutto} ct/kWh brutto (${STROM_PRIVAT_24.stand})`,
    },
    {
      source: "salzburg_ag",
      field: "electricity_base_fee_year_eur",
      value: STROM_PRIVAT_24.grundentgelt_eur_jahr_brutto,
      excerpt: `Strom Privat 24, Gesamtpreis Grundentgelt ${STROM_PRIVAT_24.grundentgelt_eur_jahr_brutto} €/Jahr brutto (${STROM_PRIVAT_24.stand})`,
    },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const log: Record<string, unknown> = { ok: true, fetched: [], suggestions: [] };

  try {
    // Aktuell gültigen History-Eintrag holen
    const { data: current } = await supabase
      .from("energy_price_history")
      .select("*")
      .lte("valid_from", new Date().toISOString().slice(0, 10))
      .or("valid_to.is.null,valid_to.gte." + new Date().toISOString().slice(0, 10))
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentValues = {
      electricity_price_cent: Number(current?.electricity_price_cent ?? 0),
      feed_in_price_cent: Number(current?.feed_in_price_cent ?? 0),
      electricity_base_fee_year_eur: Number(
        current?.electricity_base_fee_year_eur ?? 0,
      ),
    };

    const url = new URL(req.url);
    const sourceFilter = url.searchParams.get("source"); // optional: 'oemag' | 'salzburg_ag'

    const all: FetchResult[] = [];
    const errors: { source: string; error: string }[] = [];

    if (!sourceFilter || sourceFilter === "oemag") {
      try {
        all.push(...(await fetchOemag()));
      } catch (e) {
        errors.push({ source: "oemag", error: String((e as Error).message) });
      }
    }
    if (!sourceFilter || sourceFilter === "salzburg_ag") {
      try {
        all.push(...(await fetchSalzburgAg()));
      } catch (e) {
        errors.push({
          source: "salzburg_ag",
          error: String((e as Error).message),
        });
      }
    }

    (log.fetched as unknown[]).push(...all);

    // Vergleich mit aktuellen Werten + bestehenden offenen Vorschlägen
    for (const r of all) {
      const oldVal = currentValues[r.field];
      // Toleranz: 0,01 ct/kWh bzw. 0,1 €/Jahr — vermeidet Rauschen
      const tolerance = r.field === "electricity_base_fee_year_eur" ? 0.1 : 0.01;
      if (Math.abs(oldVal - r.value) < tolerance) continue;

      // Duplikat prüfen: schon ein pending Vorschlag mit gleichem source/field/new_value?
      const { data: existing } = await supabase
        .from("price_suggestions")
        .select("id")
        .eq("source", r.source)
        .eq("field", r.field)
        .eq("status", "pending")
        .eq("new_value", r.value)
        .maybeSingle();
      if (existing) continue;

      const { data: ins, error: insErr } = await supabase
        .from("price_suggestions")
        .insert({
          source: r.source,
          field: r.field,
          old_value: oldVal,
          new_value: r.value,
          effective_date: new Date().toISOString().slice(0, 10),
          raw_excerpt: r.excerpt.substring(0, 1000),
        })
        .select()
        .single();
      if (!insErr && ins) (log.suggestions as unknown[]).push(ins);
    }

    // Fehler in api_errors loggen (sichtbar im Banner)
    for (const e of errors) {
      await supabase.from("api_errors").insert({
        source: "price-fetcher",
        error_type: "fetch_failed",
        error_message: `${e.source}: ${e.error}`,
      });
    }

    return new Response(JSON.stringify({ ...log, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-energy-prices error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error).message) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
