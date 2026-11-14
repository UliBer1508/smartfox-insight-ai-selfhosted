# FIX: Min hat Vorrang, Deckel 6000 W, Vorlauf (14.11.2026)

## Anlass

In der Nacht zum 14.11.2026 lagen mehrere Räume stundenlang unter Min (Haustür ca. 2,5 h bei 20,2–20,5 °C, Min 21 °C). Die Automatik meldete „Grenze 3000 W belegt → wartet“. Drei Ursachen kamen zusammen:

1. Die Leistungsgrenze galt auch für Räume unter Min („Grenze gilt immer“, 06.11.).
2. Wer heizte, heizte fertig (09.11.), auch wenn andere Räume tiefer unter Min lagen. Das Wohnzimmer (5550 W) heizte allein und sperrte alle anderen.
3. Geheizt wurde erst, wenn der Raum schon unter Min lag. Der Estrich ist träge, deshalb fiel der Raum danach noch weiter.

Vorher (am selben Tag) wurden die Temperaturen auf drei Werte umgestellt: Min, Normal, PV-Max (doc/FIX-DREI-TEMPERATUREN-2026-11-14.md).

## Entscheidung (Uli, 14.11.2026)

- Kein Raum darf unter Min fallen, mit und ohne PV-Überschuss.
- Räume unter Min heizen zuerst, auch über die normale Grenze, aber zusammen nie über **6000 W** (Deckel).
- Gezählt wird **nur die Heizleistung**, nicht der Hausverbrauch. Das Auto lädt mit bis zu 11 kW und würde sonst die Heizung aussetzen; Warmwasser ist ohne Smartfox-Schnittstelle nicht abziehbar.
- Räume, die über Min Richtung Normal oder PV-Max heizen, werden für Min-Räume abgeschaltet.
- Vorlauf: Die Heizung startet bei Min + 0,2 °C.

## Regel (pv-automation, `allocateMin` / `allocateMinMitPlatz`)

Bei jedem Lauf (alle 5 min), nachts und tagsüber gleich:

1. **Kandidaten:** alle gesteuerten Räume mit Ist < Min + Vorlauf (`min_vorlauf_c`, 0,2 °C).
2. **Reihenfolge:** Abstand zu Min, wer am weitesten darunter liegt, zuerst. Ein Raum, der schon heizt, zählt 0,3 °C dringender, damit er nicht beim ersten kleinen Unterschied wieder abgeschaltet wird. Bei Gleichstand Priorität. Ersetzt den Wartezeit-Vorrang (`cap_wait_boost_min`, jetzt ohne Wirkung) und den festen Vorrang „wer heizt, heizt fertig“. „Behalten“ gilt weiter höchstens `cap_keep_max_min`.
3. **Zählen:** Fest zählen Räume, die heizen und nicht gesteuert werden (übersteuert, Fühler in der Sonne, nicht steuerbar). Alle anderen Räume, die heizen (DP 5) und keinen Min-Bedarf haben, sind **abschaltbar**.
4. **Zuteilen** bis zum Deckel `min_deckel_w` (6000 W). Zuerst zählen die abschaltbaren mit. Müsste dann ein Min-Raum warten, werden die abschaltbaren abgeschaltet (größte zuerst, kleine dürfen weiterlaufen, wenn Platz bleibt) und neu zugeteilt.
5. **Reservierung:** Passt der dringendste wartende Raum nicht, bekommen weniger dringende keine neue Leistung. Laufende behalten sie.
6. **Ziel** eines zugeteilten Raums: Min + Vorlauf, mit Anstoß im Schaltband. Abschalten bei Min + Vorlauf + `ziel_abschalt_ueber_c` (0,3 °C).
7. **Normal (Eco)** aus dem Netz (Tag ohne Sonne) gibt es nur, wenn kein Raum auf Min wartet, und weiter nur unter der normalen Grenze `max_grid_heating_power_w`.
8. **PV-Überschuss:** Bei der Verteilung des Überschusses kommen Räume unter Min zuerst (Sortierung `roomsWithPriority`).

Der Batterie-Schutz (`battery_gate`) begrenzt Räume unter Min nicht mehr auf 1000 W, sondern auf den Deckel, weil Min eine harte Grenze ist.

Der Planer im Modus „steuern“ ersetzt das Regelwerk weiter für Räume im Plan (heute „schatten“).

## Neue Hauswerte (SQL 40, am 14.11.2026 ausgeführt)

| Spalte | Standard | Einstellungen › Haus › Verteilung |
|---|---|---|
| `min_deckel_w` | 6000 | Höchstleistung für Min |
| `min_vorlauf_c` | 0,2 | Vorlauf vor Min |

## Nachrechnung gegen die letzten 7 Nächte

Die Entscheidungen der neuen Regel wurden im 15-Minuten-Raster auf die gemessenen Temperaturen und Heizmeldungen der Nächte 06.–13.11. (20–08 Uhr) angewendet, mit den heutigen Min-Werten.

| Nacht | Raum-Viertelstunden unter Min | alt: davon nicht geheizt | neu: davon wartend | neu: Heizleistung max / Ø |
|---|---|---|---|---|
| 07./08.11. | 223 | 223 | 1 | 5950 / 5230 W |
| 08./09.11. | 390 | 388 | 126 | 5350 / 4678 W |
| 09./10.11. | 353 | 296 | 116 | 5800 / 3722 W |
| 10./11.11. | 349 | 294 | 170 | 5750 / 2760 W |
| 11./12.11. | 347 | 304 | 159 | 5800 / 2475 W |
| 12./13.11. | 343 | 303 | 122 | 5750 / 3619 W |
| 13./14.11. | 225 | 189 | 13 | 6000 / 4600 W |

**Grenzen der Nachrechnung:**
- Sie verwendet die Temperaturen, die unter der **alten** Regel entstanden sind. Mit der neuen Regel bleiben die Räume wärmer, der Bedarf sinkt. Die echte Wirkung zeigt erst die nächste Nacht.
- Bis 14.11. galten niedrigere Min-Werte (z. B. Waschraum 18 °C). Viele Räume lagen also unter dem heutigen Min, ohne dass die alte Regel das wollte. Das macht „alt“ schlechter und den Bedarf „neu“ höher, als er künftig ist.
- Der Deckel wird nie überschritten. Die durchschnittliche Heizleistung liegt in dieser Rechnung hoch (2,5–5,6 kW), weil die Räume bei der Nachrechnung unter dem heutigen Min starten. Die Heizenergie, um 21 °C zu **halten**, bestimmt der Wärmeverlust, nicht die Regel.

## Nebenwirkungen geprüft

- **Wer liest/schreibt:** `cap_wait_state` (Wartezustand/Zuteilung) wird wie bisher geschrieben, Tag und Nacht. Der Planer (Schatten) liest nichts davon. `heating_night_mode` bekommt zusätzlich `deckel_w` und `abgeschaltet`.
- **Flattern:** Der 0,3-°C-Bonus für laufende Räume und `cap_keep_start_min` (15 min Anlaufzeit) verhindern, dass ein Raum jeden Lauf an und aus geht.
- **Großer Raum:** Das Wohnzimmer (5550 W) passt nur fast allein unter den Deckel. Es kommt dran, sobald es am weitesten unter Min liegt; danach reserviert es, bis kleinere laufende Räume fertig sind.
- **Netzstrom:** Nachts kann jetzt bis 6000 W statt 3750 W aus Batterie/Netz geheizt werden. Das ist gewollt (Min ist hart).
- **Typprüfung:** `deno check` zeigt dieselben 38 alten Fehler wie vorher, keinen neuen. Die Oberfläche baut.

## Einspielen

1. SQL 40 (bereits ausgeführt).
2. PR mergen → Vercel deployt die Oberfläche.
3. Österreich-PC: `git pull`, `supabase functions deploy pv-automation`.

## Prüfung am 15.11.2026

Die Nacht 14./15.11. wird mit den Nächten davor verglichen: Stunden unter Min je Raum, tiefster Wert, Netzbezug nachts, wie oft der Deckel erreicht wurde und wie oft Räume abgeschaltet wurden.
