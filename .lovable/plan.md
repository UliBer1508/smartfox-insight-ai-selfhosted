# Auto-Preisupdate + zeitlich korrekte Aufsummierung

## Kernprinzip
**Tageskosten werden mit dem an diesem Tag gültigen Preis berechnet und in `energy_daily_costs` gespeichert.** Monats-/Jahressummen werden NUR durch Aufsummieren der historischen Tages-€-Werte gebildet — niemals durch Multiplikation der Gesamt-kWh × aktueller Preis. Das ist heute bereits so, wird aber jetzt durch eine Preis-Historie und Auto-Update abgesichert.

## Status quo (verifiziert in `useEnergyCosts.ts` + `energy_daily_costs`)
- `energy_daily_costs` speichert pro Tag: `grid_cost_eur`, `feed_in_earnings_eur`, `pv_savings_eur`, `net_balance_eur` + den damals gültigen `electricity_price_cent` / `feed_in_price_cent` als Snapshot.
- Monat/Jahr werden bereits aus diesen gespeicherten €-Werten aufsummiert.
- ⚠️ Lücke: nur „heute" wird live mit dem aktuellen Settings-Preis berechnet — korrekt. Aber wenn der Preis **mitten am Tag** geändert wird, würde der gesamte Tag rückwirkend mit dem neuen Preis berechnet werden, bis der nächste Tag startet. Außerdem fehlt jeglicher Audit/Historie der Preisänderungen.

## 1. Neue Tabelle `energy_price_history`
Spalten:
- `id`, `valid_from` (date), `valid_to` (date, nullable = "aktuell gültig")
- `electricity_price_cent`, `feed_in_price_cent`, `electricity_base_fee_year_eur`
- `source` (`manual` | `salzburg_ag_auto` | `oemag_auto`)
- `note`, `created_at`

Regeln:
- Lückenlos & überlappungsfrei pro Tag (DB-Trigger schließt vorherigen offenen Eintrag bei Insert, setzt `valid_to = new.valid_from - 1`).
- Initial-Migration füllt mit aktuellen Werten aus `heating_settings` ab Jahresbeginn 2026.

## 2. Tageskosten an Preis-Historie binden
- Edge Function / Hook holt für jeden Tag den an diesem Tag gültigen Preis aus `energy_price_history` und schreibt ihn als Snapshot in die Tageszeile (wie heute, aber aus History statt aus Live-Settings).
- Für den **laufenden Tag** wird der heute gültige Preis verwendet; sobald ein neuer Preis mit `valid_from > today` aktiv wird, bleibt die heutige Zeile mit dem alten Preis erhalten und morgige Zeile übernimmt den neuen.
- **Vergangene Tage werden niemals neu berechnet**, auch nicht bei manueller Preiskorrektur — sie behalten ihren gespeicherten €-Wert. (Korrekturen vergangener Tage gibt es nur über expliziten "Rückwirkend neu berechnen"-Button in Settings, ausdrücklich opt-in mit Warnhinweis.)

## 3. Edge Function `fetch-energy-prices`
- **ÖMAG**: Scrape `https://www.oem-ag.at/de/marktpreis/` → aktueller Quartals-Marktpreis (ct/kWh).
- **Salzburg AG**: Scrape Tarif-Seite → Arbeitspreis + Grundgebühr Klassik-Tarif.
- Vergleicht mit letztem `energy_price_history`-Eintrag.
- Bei Abweichung → Eintrag in neue Tabelle `price_suggestions` (`source`, `field`, `old_value`, `new_value`, `effective_date`, `status` `pending`/`applied`/`dismissed`, `raw_excerpt`).
- Kein Auto-Apply — bei Geld immer manuelle Bestätigung.

## 4. Cron
- ÖMAG: wöchentlich (Mo 07:00 Vienna).
- Salzburg AG: monatlich (1. des Monats 07:00 Vienna).
- Via `pg_cron` + `net.http_post`.

## 5. UI
**a) Kostenübersicht-Card (`CostOverviewCard`)**
- Badge wenn `pending` Vorschlag existiert: „Neuer ÖMAG-Preis 7,12 ct/kWh ab 01.01.2026 — übernehmen?" mit Buttons **Übernehmen** / **Verwerfen**.
- Tooltip am Preis: „ab 01.01.2026 gültig (Quelle: ÖMAG, automatisch)".

**b) Settings → neuer Abschnitt „Tarife & Preisverlauf"**
- Tabelle mit Preis-Historie (Zeitraum, Strompreis, Einspeisetarif, Grundgebühr, Quelle).
- „Neuen Preis ab Datum eintragen"-Dialog (manuell).
- „Jetzt Preise prüfen"-Button (löst Edge Function manuell aus).
- Liste der letzten Vorschläge inkl. Verwerfen/Übernehmen.

## 6. Migration / Cleanup
- `heating_settings.electricity_price_kwh_cent` / `feed_in_price_kwh_cent` / `electricity_base_fee_year_eur` bleiben als **"aktueller" Schnellzugriff** (Spiegel des jüngsten History-Eintrags), damit bestehender Code nicht bricht. Werden via Trigger synchron gehalten, wenn neuer History-Eintrag mit `valid_from <= today` und `valid_to IS NULL` entsteht.
- Initial-Backfill: für Tage in `energy_daily_costs` ohne Preis-Snapshot wird der bisher gespeicherte `electricity_price_cent` / `feed_in_price_cent` belassen (kein Rückrechnen).

## 7. Bewusst NICHT enthalten
- Keine automatische Übernahme von Preisänderungen (Geld → immer Review).
- Kein Spot/EPEX-Preis (Salzburg AG ist Festtarif).
- Keine rückwirkende Neuberechnung außer als ausdrücklicher Settings-Button mit Warnhinweis.

## Risiken / Hinweise
- HTML-Scraping bricht ggf. bei Layout-Änderungen der Anbieter — Fehler landen in `api_errors` (Source `price-fetcher`), Banner zeigt Hinweis, manuelle Eingabe bleibt jederzeit möglich.
- Tagesgrenze ist `Europe/Vienna` — Preiswechsel um Mitternacht Vienna-Zeit.
