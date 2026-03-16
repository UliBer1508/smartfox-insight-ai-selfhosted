

# Warum der PV-Überschuss nicht genutzt wird: Analyse

## Aktuelle Situation (13:02 Uhr)

- **PV-Leistung**: 9.219 W
- **Grid-Export**: 8.871 W (wird ins Netz verschenkt!)
- **Batterie**: 100%
- **Budget**: 9.071 W verfügbar

Trotzdem werden nur 3 Räume geheizt (Bad Uli, Büro, Wirtschaftsraum) und 6+ Räume sind blockiert.

## Zwei Ursachen identifiziert

### Problem 1: Warmwasser blockiert Stufe 2 (Komfort-Heizen)

Die 4-Stufen-Logik (Zeile 1308) verlangt `!hotwaterActive` für Stufe 2 (Comfort). Räume die bereits auf eco_temp sind (z.B. Wohnzimmer 21°C >= eco 20°C) landen in Stufe 4 mit "Warmwasser aktiv → kein Komfort-Heizen".

**Das Problem**: Warmwasser war bis 13:03 aktiv (consumer_logs zeigt end_time 13:03). Aber auch OHNE Warmwasser blockiert die Logik: Stufe 2 verlangt gleichzeitig `batteryFull && !hotwaterActive && exportCoversRoom`. Bei 8.871W Export und ~600-1000W pro Raum könnte man aber **parallel mehrere Räume** auf Comfort heizen.

**Das eigentliche Problem**: Stufe 2 prüft Export gegen **einzelne** Raumleistung, aber das Budget-System oben hat bereits 9.000W der 9.071W verbraucht. Die 3 heizenden Räume (Bad Uli 600W + Büro 900W + Wirtschaftsraum 700W = 2.200W) plus irgendwelche anderen nehmen das Budget weg. Zimmer Luca (1.000W), Flur (700W), Kinder Bad (500W) werden als "Budget erschöpft" markiert obwohl 8.871W exportiert werden.

### Problem 2: Budget-Berechnung summiert ALLE Räume

Die Budget-Logik (Zeilen 745-810) summiert Heizleistungen sequenziell. Heizende Räume werden erst addiert, dann wartende. Wenn `usedBudget + heatingPower > availableBudget`, wird der Raum gesperrt. Das Log zeigt: `Budget: 8400+1000>9071W` — also wurden bereits 8.400W "verbraucht" bevor Zimmer Luca dran war.

**Aber**: gridExport ist 8.871W — das heißt das Netz exportiert gerade so viel! Die Heizleistungen werden als **gleichzeitig** betrachtet, aber bei 12 Räumen mit je 600-1000W wäre das ~9.600W total. Das Budget reicht fast für alle.

## Lösung

### Änderung 1: Warmwasser blockiert nur Stufe 2/3, NICHT Stufe 1

Räume unter eco_temp (Stufe 1) werden bereits korrekt geheizt auch bei aktivem Warmwasser. Das ist korrekt und braucht keine Änderung.

**Aber**: Räume die eco erreicht haben und bei denen genug Export da ist, sollten trotzdem auf Comfort heizen können — auch wenn Warmwasser aktiv ist, solange der Export die Heizleistung + Warmwasser abdeckt. Warmwasser sperrt aktuell ~6 Räume komplett, obwohl 8.871W Export da sind.

### Änderung 2: Budget-Berechnung berücksichtigt tatsächlichen Verbrauch

Das Budget addiert `heatingPower` für jeden Raum als ob alle gleichzeitig die volle Leistung ziehen. In Wahrheit heizen Fußbodenheizungs-Thermostate aber nicht alle gleichzeitig mit voller Leistung — sie regeln.

**Konkrete Änderung in `pv-automation/index.ts`**:

1. **Warmwasser-Sperre nur bei knappem Export**: Statt `!hotwaterActive` als harte Bedingung, prüfen ob `gridExport >= roomHeatingPower + hotwaterPower`. Wenn genug Export für beides da ist, darf auch bei aktivem Warmwasser geheizt werden.

2. **Budget-Toleranz erhöhen**: Die aktuelle Toleranz ist nur 200W. Bei 8.871W Export und ~9.600W Gesamtleistung fehlen nur ~730W. Eine Toleranz von z.B. 20% des Exports würde erlauben alle Räume gleichzeitig zu heizen wenn genug PV da ist.

### Dateien

| Datei | Änderung |
|-------|----------|
| `supabase/functions/pv-automation/index.ts` | Warmwasser-Sperre nur bei knappem Export, Budget-Toleranz auf 20% des gridExport |

