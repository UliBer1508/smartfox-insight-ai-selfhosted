# Code-Review: pv-automation (Befundliste)

**Datum:** 30. Juni 2026
**Datei:** `supabase/functions/pv-automation/index.ts` (3.814 Zeilen)
**Methode:** Gezielte Durchsicht nach bekannten Fehlerklassen (Zeitzone/Datum, Vorzeichen, Schwellwerte, Division/Null). **Nur Lesen — keine Fixes angewendet.**
**Wichtig:** Ein reiner Code-Review findet nur einen Teil möglicher Fehler. Die schwersten Probleme heute (leere `heating_settings`, `energy_in=0`) zeigten sich erst bei der Daten-Verifikation. Mehrere Befunde unten brauchen **Daten-Verifikation**, bevor sie als sicher gelten.

---

## ZUSAMMENFASSUNG

Die `pv-automation` ist insgesamt **gut und durchdacht gebaut**. Die historischen Zeitzonen-Bugs (Doppelcast, `slice(1,10)`) sind **behoben** — die Datumslogik ist heute durchweg sauber. Division-durch-Null ist solide abgesichert. Gefunden wurden: **1 wichtiger Verifikationspunkt** (Batterie-Vorzeichen), **1 kleiner Zeitzonenfehler**, sowie einige **veraltete Kommentare/Annahmen** aus der Smartfox-Ära.

Schweregrad-Legende: 🔴 kritisch (Verhalten falsch) · 🟡 mittel (Ungenauigkeit) · 🟢 kosmetisch (Kommentar/Klarheit)

---

## ✅ BEFUND 1 — Batterie-Vorzeichen: VERIFIZIERT, KEIN BUG (nur Kommentar irreführend)

**Zeile 1435–1442:**
```js
const rawBatteryPower = reading.battery_power || 0;
// Smartfox-Konvention: negativ=laden, positiv=entladen   ← Kommentar nennt falsche Quelle
// Normalisierung: positiv=laden, negativ=entladen (für Budget-Logik)
const batteryPower = -rawBatteryPower;
const batteryChargingW = Math.max(0, batteryPower);
const batteryDischargingW = Math.max(0, -batteryPower);
```

**Verdacht (ursprünglich):** Kommentar verweist auf „Smartfox-Konvention", aber Daten kommen vom Fronius. Befürchtung: Inversion könnte falsch sein → Batterie-Reserve-Logik invertiert.

**VERIFIZIERT am 30.06. per Daten — Inversion ist KORREKT:**
Messreihe 29.06. ab 18:17 Uhr: PV fällt auf ~20 W (Abend), Verbrauch ~230 W, **SOC sinkt** kontinuierlich (97.7 → 97.2) = Batterie **entlädt**. `battery_power` ist dabei durchgehend **positiv** (+247…+260).
→ Fronius-Konvention: **positiv = entladen, negativ = laden** — exakt wie der Code annimmt. Die Inversion `-rawBatteryPower` erzeugt korrekt „positiv=laden, negativ=entladen" für die Budget-Logik. **Kein Verhaltensfehler.**

**Verbleibender Punkt (🟢 kosmetisch):** Der Kommentar „Smartfox-Konvention" nennt die falsche Datenquelle (Daten kommen von Fronius, nicht Smartfox — die Konvention ist aber zufällig dieselbe). Sollte korrigiert werden, damit künftige Änderungen nicht auf falscher Quellenannahme aufbauen:
```js
// Fronius-Konvention (P_Akku): negativ=laden, positiv=entladen
```
**Reine Kommentar-Änderung, kein dringendes Deploy.**

**Lehre:** Messen vor Fixen war richtig — eine „sofortige Korrektur" hätte hier funktionierende Logik invertiert und die Batteriesteuerung kaputtgemacht.

---

## 🟡 BEFUND 2 — Zeitzonenfehler in forecastAccuracy-Fenster

**Zeile 1327:**
```js
const todayStart = `${today}T06:00:00`;   // ohne Zeitzonen-Offset!
```

**Problem:** `today` ist Wien-Datum, aber `...T06:00:00` ohne `+02:00` wird als **UTC** interpretiert. Der Filter greift ab 06:00 UTC = **08:00 Wien** statt 06:00 Wien. Die Trapez-Integration der tatsächlichen PV-Produktion (für `forecastAccuracy`) startet 2 h zu spät.

**Folge:** `forecastAccuracy` ist in den frühen Morgenstunden leicht verzerrt → Eco-Budget-Korrektur am Morgen ungenau. Nicht gravierend (Accuracy ist nur Korrekturfaktor), aber dieselbe Zeitzonen-Familie wie die alten Bugs.

**Fix-Richtung:** Offset ergänzen, z.B. `` `${today}T06:00:00+02:00` `` (Sommer) bzw. sauberer über eine Wien-bewusste Berechnung. ⚠️ DST-Vorbehalt wie bei den Cron-Jobs.

---

## 🟢 BEFUND 3 — Veraltete „Smartfox"-Kommentare/Referenzen

Mehrere Logs und Kommentare verweisen auf „Smartfox" als Datenquelle oder rechnen mit „Smartfox-Konvention", obwohl Smartfox **gar keine Daten liefert** (nur Fronius). Beispiele:
- Z.1433: Log `…WW+Auto=Smartfox-autonom…`
- Z.1436–1437: Kommentar „Smartfox-Konvention"

**Folge:** Keine funktionale — aber **irreführend** und genau die Art Annahme, die zu Befund 1 geführt hat. Sollte bei Gelegenheit auf „Fronius" korrigiert werden, damit künftige Änderungen nicht auf falschen Annahmen aufbauen.

---

## ✅ GEPRÜFT & KORREKT (nicht anfassen)

- **Zeitzonen-/Datumslogik durchweg sauber:** `toLocaleDateString('en-CA', {timeZone:'Europe/Vienna'})`, `Intl.DateTimeFormat`, direkte Stunden-Extraktion. Die alten Bugs (Doppelcast Z.735, `slice(1,10)` Z.1104) sind behoben. `isNightTime()` korrekt.
- **Grid-Vorzeichen korrekt:** `gridExport = power_io < 0 ? -power_io : 0` (Z.1036, 1501) — stimmt mit verifizierter Fronius-Konvention überein (negativ = Einspeisung). **Heute an echten Daten bestätigt** (−9954 W bei Einspeisung).
- **Division-durch-Null abgesichert:** `Math.max(1, …)`, `nullif`-Muster, `totalEcoEnergyNeededWh > 0`-Guards vor Ratio-Berechnungen.
- **Schwellwert-Defaults robust:** `?? 80`, `|| 500`, `|| 200` — greifen sauber wenn Settings fehlen.
- **Trapezintegral mit Lücken-Schutz** (Z.1338–1347): ignoriert Lücken >10 min (Collector-Ausfall) — sauber.
- **Forecast-Key-Format** (Z.1321): `"YYYY-MM-DD HH:00:00"` korrekt (alter Bug behoben, siehe Kommentar Z.1318).

---

## NÄCHSTE REVIEW-SCHRITTE (noch offen)

Dieser Review deckte **pv-automation** ab. Noch nicht geprüft:
1. **Datenpipeline:** `aggregate-energy-data`, `ml-feature-extraction`, `evaluate-decision` — gleiche kWh-/Vorzeichen-/Zeitzonen-Fehlerklassen wahrscheinlich. (Beachte: `aggregate-energy-data` schreibt `hourly_aggregates`, die in der alten RPC für energy_in/out genutzt wurden — könnte denselben energy_in=0-Folgefehler haben.)
2. **`analyze-patterns` / `update-learned-policies`:** Reward-Logik, ob das Lernen sinnvoll rechnet.
3. **`calculate-heating-power`:** Power-Kalibrierung (geht in totalEcoEnergyNeededWh ein).
4. **Frontend-Hooks:** ob Dashboard-Werte korrekt aus den (teils erst heute reparierten) Feldern lesen.

**Empfehlung:** Befund 1 (Batterie-Vorzeichen) zuerst per SQL verifizieren — das ist der einzige potenziell verhaltensändernde Fund und betrifft die Kern-Budget-Logik.
