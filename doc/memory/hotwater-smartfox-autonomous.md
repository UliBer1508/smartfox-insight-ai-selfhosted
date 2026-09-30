---
name: Warmwasser autonom via Smartfox
description: WW wird ausschließlich von Smartfox gesteuert. pv-automation zieht KEINE WW-Momentan-Reserve vom Heizbudget ab.
type: constraint
---

**Regel:** Warmwasserbereitung (Heizstab am Boiler) wird vollständig autonom vom Smartfox-Energiemanager geschaltet. Die Software (`pv-automation`) darf **niemals** eine Momentan-Leistungsreserve für Warmwasser vom Eco- oder Komfort-Heizbudget abziehen.

**Begründung:**
- Wenn Smartfox den WW-Heizstab einschaltet, sinkt `gridExport` automatisch um die WW-Leistung — die Reserve ist also bereits **physikalisch** im Messwert enthalten.
- Eine zusätzliche Software-Reserve führt zu **Doppelbuchung**: das Komfort-Budget würde künstlich um bis zu ~2800 W reduziert, obwohl real Überschuss vorhanden ist (Bsp.: 9,8 kW Export → fälschlich nur 7,0 kW Komfort-Budget).
- Räume können dadurch nicht auf Komfort hochlaufen, obwohl genug PV-Leistung da ist.

**Konkrete Implementierung in `supabase/functions/pv-automation/index.ts`:**
- `hotwaterReserveW` ist hart `= 0` (siehe ~Zeile 1271).
- `consumer_priority`-Reihenfolge zwischen `hotwater` und `heating` ist für die Budgetberechnung **irrelevant**. Sie hat nur dokumentarischen Charakter.
- `carReserveW` (E-Auto-Wallbox) bleibt aktiv — dort gibt es keine vergleichbare autonome Steuerung.

**Erlaubte WW-Berücksichtigungen:**
- `hotwaterKwh` im **Tagesenergie-Modell** (Pre-Heat-Boost, ~Zeile 1071): OK — das ist eine kWh-Tagesprognose, keine Momentan-Leistungsreserve.
- `superComfortAllowed`-Gate (`!hotwaterActive`, ~Zeile 2610): OK — verhindert nur Über-Komfort-Sprünge während aktiver WW-Phase.

**UI:** Im `HeatingSettingsForm.tsx` zeigt der WW-Block einen Hinweis, dass die Werte nur der Tagesprognose dienen und das Momentan-Budget nicht beeinflussen.
