-- SQL 36 (12.11.2026): Strompreis nach Jahresabrechnung Salzburg AG vom 15.10.2026 (Strom Privat 24, Okt 2025 – Sep 2026)
-- Arbeitspreis 29,9351 ct/kWh brutto stimmt (Preise ab 01.01.2026, netto):
--   Energie 16,90 + Netznutzung 6,59 + Netzverlust 0,357 + EAG Netznutzung 0,583 + EAG Netzverlust 0,037
--   + Gebrauchsabgabe 0,3789 + Elektrizitätsabgabe 0,10 = 24,9459 ct netto × 1,2 = 29,9351 ct brutto
-- Grundgebühr war zu niedrig: das Messentgelt (27,60 €/Jahr netto) fehlte.
--   Energiegrundentgelt 30,00 + Netzpauschale 54,00 + Messentgelt 27,60 + EAG-Förderpauschale 19,02
--   + EAG-Förderbeitrag Netzpauschale 3,796 = 134,416 € netto × 1,2 = 161,2992 € brutto (bisher 128,1792)
-- Nicht abgebildet (bewusst): Strompreisdeckel (−6,461 ct auf eine gedeckelte Menge, 2026 bis Sep. 1.122 kWh),
--   „Frei-Tage“-Gutschriften (≈ −24,82 €/Jahr netto), SNAP-Sommertarif (Apr–Sep 10–16 Uhr Netz 5,27 statt 6,59 ct).
--   Für die Steuerung zählt der Preis der nächsten Netz-kWh – das sind 29,94 ct.
-- Einspeisung 6,772 ct (ÖMAG-Richtwert) steht nicht auf dieser Rechnung und bleibt.
-- Wirkung: energie_tag.grundgebuehr_eur ab 13.10.2026 neu (≈ 0,44 statt 0,35 €/Tag). Netzkosten je kWh unverändert.
-- Gleichzeitig: fetch-energy-prices auf 161,2992 (sonst schlägt sie den alten Wert wieder vor).

update public.energy_price_history
   set electricity_base_fee_year_eur = 161.2992,
       note = 'Salzburg AG Strom Privat 24 lt. Jahresabrechnung 15.10.2026 (inkl. Messentgelt) + ÖMAG PV Richtwert'
 where valid_from = '2026-01-01' and valid_to is null;

update public.heating_settings set electricity_base_fee_year_eur = 161.30;

-- energie_tag mit der neuen Grundgebühr nachrechnen
do $$
declare d date;
begin
  for d in select tag from public.energie_tag order by tag loop
    perform public.energie_tag_rechnen(d);
  end loop;
end $$;

-- Prüfen
select valid_from, electricity_price_cent, electricity_base_fee_year_eur, feed_in_price_cent from public.energy_price_history order by valid_from;
select tag, netz_kwh, netz_kosten_eur, grundgebuehr_eur from public.energie_tag order by tag desc limit 3;
