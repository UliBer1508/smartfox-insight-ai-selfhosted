// Edge Function: fetch-energy-prices
// Scraped ÖMAG-Marktpreis und Salzburg AG Tarife, vergleicht mit aktuellen
// Werten und legt bei Abweichung price_suggestions an (kein Auto-Apply).
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

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SmartfoxInsightAI/1.0; +https://lovable.dev)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function parseGermanNumber(s: string): number | null {
  // "7,12" -> 7.12 ; "20,28" -> 20.28
  const m = s.replace(/\s/g, "").match(/(-?\d+[,.]\d+)/);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}

// --- ÖMAG ---
async function fetchOemag(): Promise<FetchResult[]> {
  const html = await fetchHtml("https://www.oem-ag.at/de/marktpreis/");
  const results: FetchResult[] = [];

  // Suche "Marktpreis ... <ct>" Pattern, z.B. "Marktpreis 4. Quartal 2025: 7,12 Cent/kWh"
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const matches = [
    ...text.matchAll(/Marktpreis[^0-9]{0,80}(\d+[,.]\d+)\s*(?:Cent|ct)\s*\/\s*kWh/gi),
  ];

  if (matches.length > 0) {
    // Erstes Match = aktueller Wert (in Reihenfolge der Seite)
    const m = matches[0];
    const v = parseGermanNumber(m[1]);
    if (v !== null && v > 0 && v < 100) {
      const excerpt = text.substring(
        Math.max(0, (m.index ?? 0) - 60),
        Math.min(text.length, (m.index ?? 0) + 120),
      );
      results.push({
        source: "oemag",
        field: "feed_in_price_cent",
        value: v,
        excerpt: excerpt.trim(),
      });
    }
  }

  return results;
}

// --- Salzburg AG (Privat Klassik) ---
async function fetchSalzburgAg(): Promise<FetchResult[]> {
  const url =
    "https://www.salzburg-ag.at/privat/strom/tarife/oekoenergie-klassik.html";
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch {
    html = await fetchHtml("https://www.salzburg-ag.at/privat/strom/tarife.html");
  }
  const results: FetchResult[] = [];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Arbeitspreis: "Arbeitspreis ... 20,28 Cent/kWh" oder "ct/kWh"
  const arb = text.match(
    /Arbeitspreis[^0-9]{0,80}(\d+[,.]\d+)\s*(?:Cent|ct)\s*\/?\s*kWh/i,
  );
  if (arb) {
    const v = parseGermanNumber(arb[1]);
    if (v !== null && v > 5 && v < 80) {
      results.push({
        source: "salzburg_ag",
        field: "electricity_price_cent",
        value: v,
        excerpt: arb[0].trim(),
      });
    }
  }

  // Grundgebühr: "Grundpreis ... 3,00 €/Monat" → *12, oder "36,00 €/Jahr"
  const grundYear = text.match(
    /Grundpreis[^0-9]{0,80}(\d+[,.]\d+)\s*€\s*\/\s*Jahr/i,
  );
  const grundMonth = text.match(
    /Grundpreis[^0-9]{0,80}(\d+[,.]\d+)\s*€\s*\/\s*Monat/i,
  );
  let baseFeeYear: number | null = null;
  let excerpt = "";
  if (grundYear) {
    baseFeeYear = parseGermanNumber(grundYear[1]);
    excerpt = grundYear[0].trim();
  } else if (grundMonth) {
    const m = parseGermanNumber(grundMonth[1]);
    if (m !== null) baseFeeYear = +(m * 12).toFixed(2);
    excerpt = grundMonth[0].trim();
  }
  if (baseFeeYear !== null && baseFeeYear > 5 && baseFeeYear < 500) {
    results.push({
      source: "salzburg_ag",
      field: "electricity_base_fee_year_eur",
      value: baseFeeYear,
      excerpt,
    });
  }

  return results;
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
