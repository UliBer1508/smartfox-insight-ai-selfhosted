## Ziel

Verhindern, dass die KI-Einstellungsvorschläge `heating_min_battery_soc` als Lade-Obergrenze missverstehen und unsinnige Empfehlungen wie „Batterie nur bis X% laden, Rest in Heizung" abgeben. Die Batterie wird ausschließlich von Smartfox/Fronius gesteuert — die Software kann den Ladevorgang nicht beeinflussen.

## Faktenlage (geprüft)

- `mem://features/heating/soc-thresholds-consolidated`: `heating_min_battery_soc` (default 80%) ist die **Untergrenze**, ab der Komfort-Heizung blockiert wird (SOC-Gate, Komfort-Hard-Lock).
- `mem://arch/pv-automation-budget-logic-v2`: SOC-Gate „schützt definierten Schwellwert" — also Floor, nicht Cap.
- `mem://hardware/energy-system-specifications` & Core-Memory: „Fronius manages battery."
- Im Edge-Function-Prompt von `generate-settings-suggestions/index.ts` steht aktuell nur `Heiz-Min-Batterie-SOC: 80%` ohne Erklärung der Semantik und ohne Hinweis auf Smartfox-autonome Ladesteuerung. Daher rät das Modell eine plausibel klingende, aber falsche Bedeutung.

→ Die KI-Aussage war fachlich falsch, nicht nur missverständlich.

## Umsetzung

### 1. `supabase/functions/generate-settings-suggestions/index.ts`
System-Prompt um einen klaren Hardware-/Semantik-Block ergänzen, direkt nach der 4-Stufen-Logik:

```
HARDWARE-FAKTEN (nicht verhandelbar):
- Die Batterie wird ausschließlich vom Smartfox/Fronius-Wechselrichter gesteuert.
  Die Software kann das LADEN der Batterie NICHT beeinflussen.
  Schlage NIEMALS Ladeobergrenzen, Lade-Limits oder „Batterie nur bis X% laden"
  vor — solche Einstellungen existieren nicht.
- Warmwasser wird autonom von Smartfox gesteuert. Schlage keine WW-Steuerung
  über die Heizungs-Settings vor.

SEMANTIK heating_min_battery_soc (KRITISCH):
- Das ist eine UNTERGRENZE (Floor), KEINE Obergrenze.
- Bedeutung: Nur SOC-Anteil ÜBER diesem Wert darf für Komfort-Heizung verbraucht werden.
- Beispiel: Wert 90% → die obersten 10% der Batterie sind für Heizung freigegeben,
  90% bleiben als Reserve geschützt.
- Sobald SOC < heating_min_battery_soc: Komfort-Hard-Lock (comfortBudget = 0),
  Eco bleibt erlaubt.
- Höherer Wert = weniger Batterie für Heizung verfügbar = mehr Reserve.
- Niedrigerer Wert = mehr Batterie für Heizung verfügbar = weniger Reserve.
```

Zusätzlich im Datenkontext-Block die Bezeichnung umbenennen, damit sie selbsterklärend ist:
- `Heiz-Min-Batterie-SOC: 80%` → `heating_min_battery_soc (Untergrenze für Komfort-Heizung): 80%`

### 2. `supabase/functions/analyze-patterns/index.ts`
Gleichen Hardware-/Semantik-Block in den System-Prompt aufnehmen (gleiche Verwechslungsgefahr).

### 3. Memory-Update
Neue Memory-Datei `mem://arch/ai-prompt-hardware-facts.md` anlegen, damit künftige Edge-Function-Prompts diesen Block standardmäßig enthalten. Index aktualisieren.

## Nicht im Scope

- Keine Änderung der Automatisierungslogik selbst (Floor-Verhalten ist korrekt).
- Keine UI-Änderungen.
- Keine DB-/Migrations-Änderungen.
