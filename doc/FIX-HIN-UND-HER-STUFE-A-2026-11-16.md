# FIX: Hin und Her der Sollwerte – Stufe A (16.11.2026)

Konzept: `doc/KONZEPT-HIN-UND-HER-BEENDEN-2026-11-16.md` (PR #71). Uli: „stufe a bauen“, dazu:
„Ich weiß nicht, was die richtige Haltezeit ist, die wird wahrscheinlich im Laufe des Jahres variieren. Das gleiche gilt für 2.“
Deshalb gibt es **keine feste Haltezeit**. Beide Zeiten werden täglich aus den Messwerten gelernt, in der App gezeigt und
können dort überschrieben werden.

## Was ist „Hin und Her“?

Ein Raum bekommt Befehl A, kurz danach B und innerhalb von 15 min wieder A. Jeder Wechsel kostet einen Befehl, das
Thermostat reagiert erst nach 3–9 min, und in der Protokoll-Ansicht sieht es aus, als wüsste die Steuerung nicht, was sie will.
Ziel: unter 2 % der Befehle.

## Gelernte Werte (SQL 46, schon eingespielt)

| Wert | Bedeutung | Wie gelernt | Heute |
|---|---|---|---|
| `halte_min` | So lange gilt ein Befehl mindestens, bevor er umgekehrt werden darf | 90 %-Wert „Anstoß-Befehl → erste Lesung heizt“, 7 Tage, aufgerundet, 5–20 min. Weniger als 20 Messungen: 10 min | **9 min** (381 Messungen) |
| `pv_halten_min` | So lange behält ein Raum sein PV-Budget über einen Einbruch der Einspeisung | 90 %-Wert der Dauer kurzer Einbrüche (≥ 200 W → < 50 W → ≥ 200 W, 9–15 Uhr, ≤ 60 min), 14 Tage, auf 5 min aufgerundet, 5–30 min. Weniger als 3 Einbrüche: 10 min | **10 min** (16 Einbrüche, 90 % ≤ 7,5 min) |

- `haltezeiten_lernen()` läuft jede Nacht um 03:25 Wien (pg_cron `haltezeiten-lernen`) und schreibt in system_settings `haltezeiten`.
- Eigene Vorgabe in system_settings `haltezeiten_vorgabe` (`null` = automatisch). Die Vorgabe hat Vorrang.
- `hin_und_her_tage(p_tage)` zählt je Tag: Befehle, Hin und Her, Anteil in %.

## Änderungen in pv-automation

### A1 – Haltezeit (Tag und Nacht)

Ein neues Ziel wird **nicht gesendet**, wenn es den letzten Befehl innerhalb der Haltezeit umkehrt. Der Sollwert bleibt dann auf dem letzten Befehl.

- Umkehr heißt: Der letzte Befehl hat angehoben (gesenkt) und der neue senkt (hebt) wieder, jeweils um mindestens 0,25 °C.
- Wo die Prüfung sitzt:
  - Tag: in der Raumschleife nach der Skip-Logik, vor dem Senden. Ein zurückgehaltener Raum wird als Aktion `haltezeit` gemeldet und erzeugt kein Lern-Ereignis.
  - Nacht: vor dem Speichern des Nachtplans. Die Begründung bekommt „– Haltezeit bis HH:MM“.
- **Ausnahmen** (immer erlaubt):
  - Zwingende Ziele:
    - Min-Vorrang „heizt bis“, auch mit Anstoß
    - „wartet“ wegen Deckel
    - „für Min-Räume abgeschaltet“
    - „Min/Eco erreicht → Thermostat aus“
    - Komfort-Sättigung
    - Planer-Sicherheit „unter Min“ und „über Komfort“
    - Regel-Stopp „ohne PV nur bis Min/Normal“
  - Anheben, wenn der Raum unter Min + Vorlauf liegt
  - Senken, wenn der Raum über PV-Max + 0,3 °C liegt
  - Prüfbefehl an ein nicht steuerbares Thermostat
  - Raum ohne Messwert
- Nicht geprüft werden die eigenen Sicherheitsbefehle: Frostschutz, Batterie-Notfall, Mikro-Ende und Über-Temperatur.
- Zurückgehaltene Räume stehen in system_settings `haltezeit_aktiv` (`bis`, letzter Befehl, Vorschlag). Die App zeigt das an.

### A2 – PV-Zusage halten (nur Tag, Phase 1/2)

- Phase 1/2 rechnen mit der Einspeisung dieses Augenblicks. Ein kurzer Einbruch (Wolke, Warmwasser) nahm einem Raum das Budget nach im Schnitt 5,5 min wieder weg.
- Jetzt behält ein Raum eine echte PV-Zusage (system_settings `pv_grant_state`), solange **alle** Bedingungen gelten:
  - Die letzte echte Zusage ist höchstens `pv_halten_min` alt.
  - Kein Batterie-Schutz, vor Sonnenuntergang, PV > 500 W.
  - Die Prognose für diese oder die nächste Stunde (× Prognose-Genauigkeit) deckt Grundlast 500 W + Raumleistung.
  - Der Raum braucht die Zusage noch (Ist < Eco bzw. PV-Max − 0,3 °C).
  - Der Raum hat sie nur wegen Hysterese, fehlendem Budget oder „Phase 2 wartet“ verloren, nicht wegen Rotation, Pause, Sättigung oder offline.
- Gehaltene Zusagen verlängern sich nicht. Nach `pv_halten_min` ab der letzten echten Zusage ist Schluss.

### A3 – Nicht wieder auf Min anheben

- Das häufigste Muster war „Min erreicht → Thermostat aus“ und gleich danach „hält Min“: Der Sollwert ging wieder hoch, ohne dass der Raum Wärme brauchte.
- Jetzt bleibt der niedrige Sollwert stehen, wenn alle Bedingungen gelten:
  - Der Raum ist über Min + Vorlauf.
  - Das Thermostat ist aus.
  - Der Sollwert liegt darunter, aber höchstens 2 °C (Sicherheitsboden).
- Gilt auch für „Eco halten (Raum warm)“ im Modus `grid`.
- Fällt der Raum unter Min + Vorlauf, übernimmt die Min-Vorrang-Zuteilung wie bisher.
- Gilt nur im Lokal-Modus, wie Anstoß und „Ziel erreicht → aus“. Gilt auch nachts.

## App

- **Einstellungen › Haltezeiten** (neu, unter „Haus“):
  - Zeigt die gelernten Werte mit Messbasis und Stand.
  - Zwei Felder für eine eigene Vorgabe (leer = automatisch, 0–60 min).
  - Darunter „Hin und Her“ der letzten 7 Tage, grün unter 2 %.
- **Übersicht › Heizung jetzt:** Bei einem zurückgehaltenen Raum steht in der Begründung „Haltezeit bis HH:MM: Befehl X °C von HH:MM bleibt (sonst Y °C)“.

## Nachgerechnet (Befehle 13.–16.11., Muster A → B → A innerhalb 15 min)

| Tag | Hin und Her | weg durch A3 | weg durch A1 | bleibt (zwingend) |
|---|---|---|---|---|
| 13.11. | 1 | 0 | 1 | 0 |
| 14.11. | 23 | 15 | 6 | 2 |
| 15.11. | 7 | 5 | 1 | 1 |
| 16.11. | 18 | 4 | 6 | 8 |
| **Summe** | **49** | **24** | **14** | **11** |

- Rund **78 %** des Hin und Her fallen weg.
- Der Rest ist gewollt: Min-Vorrang und Deckel. Am 16.11. kommt der größte Teil davon vom Batterie-Schutz-Pingpong, das PR #68 schon behebt.
- A2 ist hier nicht eingerechnet. Es wirkt auf Umkehrungen nach mehr als 9 min (Einbrüche bis 10 min).
- Genauer misst es ab morgen die App (`hin_und_her_tage`).

## Nebenwirkungen

- **Bis zu `halte_min` (9 min) länger heizen oder warten.** Senkt die Steuerung innerhalb der Haltezeit nach einem Anheben wieder, heizt der Raum bis zum Ende der Haltezeit weiter, auch aus Netz oder Batterie. Grenze: höchstens eine Raumleistung × 9 min ≈ 0,1–0,3 kWh je Fall. Gegenfall: Ein Raum, der gerade abgeschaltet wurde, startet frühestens nach der Haltezeit wieder, außer er fällt unter Min.
- **A2 kann kurz Netz/Batterie nutzen.** Hält die Zusage über einen Einbruch, der doch länger dauert, heizt der Raum bis `pv_halten_min` (10 min) ohne Überschuss. Prognose-Bedingung und Batterie-Schutz begrenzen das.
- **A3: niedrigerer Sollwert über längere Zeit.** Fällt die Steuerung aus, kann der Raum bis zu 2 °C unter Min fallen, bevor das Thermostat selbst einschaltet (vorher: Min − Schaltband 1 °C). Die Steuerung läuft alle 2 min; der Watchdog meldet Ausfälle.
- **Weniger Lern-Ereignisse.** Zurückgehaltene Befehle erzeugen keins. Das ist gewollt, weil sie nicht ausgeführt werden.
- **Phase-1/2-Budget:** Gehaltene Räume zählen nicht in `usedBudget`. Ein anderer Raum kann im selben Lauf zusätzlich Budget bekommen. Das ist begrenzt auf die Haltezeit und nur bei guter Prognose.
- **Unverändert:** Frostschutz, Batterie-Notfall, Über-Temperatur, Mikro-Ende, Cooldown 25 min, Planer-Logik.

## Prüfen nach dem Deploy

- Logs `[HALTEZEIT]` (Quelle der Werte, zurückgehaltene Räume) und `[PV-HALTEN]`.
- system_settings `haltezeit_aktiv` und `pv_grant_state`.
- `select * from hin_und_her_tage(7);` Ziel: unter 2 % ab dem ersten vollen Tag.

## Danach (Stufe B, eigener PR)

- Toten Code entfernen (Prüfung 10.11., Vorschlag J): Phase-2-Reste, die der Tagesmodus ersetzt.
- Wenn A2 sich bewährt: Phase 2 nicht mehr allein auf den Augenblicks-Export stützen.
