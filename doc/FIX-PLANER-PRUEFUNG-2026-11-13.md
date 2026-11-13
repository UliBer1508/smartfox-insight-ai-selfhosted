# Planer: Netzwärme nicht mehr „gratis“ und Plan-Prüfung je Raum (13.11.2026)

**Anlass (Uli, 13.11.2026 mittags):** „Warum heizen Toilette und Wirtschaftsraum ständig? Warum heizt das Wohnzimmer
ständig? Warum sieht die KI das nicht und reagiert?“ – „Ich möchte die Steuerung selbst an- und ausschalten; wenn ich
sie anschalte, soll der Planer entsprechend reagieren. Die KI soll solche Fehler identifizieren und reagieren.“ –
„Wir wissen, wie lange ein Raum zum Auskühlen braucht und wie lange zum Aufheizen – also wissen wir, wie lange das
Heizen dauern darf. Wenn etwas schief läuft, hat die KI zu reagieren.“

**Dateien:** `supabase/functions/heizplaner/` (`modell.ts`, `rechnen.ts`, `index.ts`, neu `pruefung.ts`),
`supabase/functions/pv-automation/index.ts` (1 Zeile), App `PlanerView.tsx`, `AutoSteuerung.tsx`, SQL 38.

---

## 1. Befund

Seit 13.11. 12:09 steuerte der Planer (Modus „steuern“). Plan von 12:45:

| Raum | geplant (24 h) | Problem |
|---|---|---|
| Wirtschaftsraum | 11,5 h × 2 kW | u. a. nachts 04:15–08:15 aus dem Netz, obwohl Nachtziel 19 °C und Raum darüber |
| Toilette Eingang | 9,5 h × 100 W | Eco 21 °C, Raum erreicht es meist nicht |
| Wohnzimmer | 3,5 h × 5,5 kW | 12:45–14:45 auf 21,3 °C bei Ziel 20 °C, großteils aus dem Netz |
| gesamt | 62,5 kWh Heizen, **37,1 kWh Netz** | Gegenrechnung 12.11.: Planer 46 kWh Netz statt 39,7 kWh (Regel-Steuerung) |

(Korrektur zur ersten Auskunft im Chat: Die Zeichen im Plan sind 15-Minuten-Slots, nicht halbe Stunden – also 11,5 h
statt „23 h“ für den Wirtschaftsraum, 9,5 h statt „19 h“ für die Toilette.)

**Ursache:** Seit dem Umbau am 13.11. vormittags zählt die Wärme im Estrich am Planende mit `waermeRest = 0,9`, also
90 % so viel wie Netzstrom. Damit kostete es den Planer rechnerisch nur 10 %, Netzstrom in den Estrich zu heizen. Räume
mit großem Estrich-Speicher im Modell (Wirtschaftsraum: ~12 kWh je °C) sahen aus wie eine billige Batterie.

**Zweite Ursache (Anzeige):** Das Etikett im Plan stand fest auf „Schattenbetrieb · steuert nicht“, egal welcher Modus.

## 2. Messwerte statt Annahmen (SQL 38 `raum_messwerte`)

Aus `room_temperature_samples` der letzten 14 Tage, je Raum:

| Raum | Fühler beim Heizen | bleibt (2 h danach) | geheizt je Tag |
|---|---|---|---|
| Wirtschaftsraum | +3,6 °C/h | **+0,25 °C/h** | 2,0 h |
| Wohnzimmer | +1,2 °C/h | +1,0 °C/h | 2,5 h |
| Toilette Eingang | +1,1 °C/h | +0,15 °C/h | 3,6 h (letzte 3 Tage 9 h) |
| Zimmer Uli | +4,8 °C/h | +0,8 °C/h | 1,0 h |

**Wichtig:** Der Fühler im Thermostat wird beim Heizen kurz warm und fällt danach zurück (Fußbodenheizung). Für
„wie lange dauert 1 °C aufheizen“ zählt deshalb, was 2 h nach dem Heizen bleibt (`auf_dauer_k_h`), nicht der
Höchstwert (`auf_k_h`, nur zur Anzeige). Die Auskühlung steckt in den gemessenen Heizstunden je Tag: so viel muss der
Raum heizen, um seine Temperatur zu halten. (Die alte Nacht-Auskühlung `raum_abkuehlung` wurde am 12.11. bewusst
durch das Heizmodell ersetzt – SQL 34 – und wird nicht wieder aufgebaut.)

## 3. Korrektur im Rechenkern (`modell.ts`, `rechnen.ts`)

Wärme am Planende wird **asymmetrisch** bewertet (`waermeWert`):

- **Weniger** Wärme als zu Beginn kostet weiter 0,9 je kWh (der Plan darf den Estrich nicht leeren) – aber nur, wenn
  der Raum am Ende **unter** seinem Ziel liegt. Endet er am oder über dem Ziel, war die Wärme Überschuss.
- **Mehr** Wärme zählt nur so viel wie PV-Strom, der sonst eingespeist würde (`waermeMehr` = Einspeise/Bezug + 0,05,
  heute 0,28). Heizen aus dem Netz in den Estrich lohnt sich damit nicht mehr, PV-Überschuss bis Komfort schon
  (Grundsatz Uli 07.11.: „Komfort ist das Maximum, bis Komfort heizen ist der Estrich-Speicher“).

## 4. Plan-Prüfung je Raum (`pruefung.ts`)

Bei jedem Plan (alle 15 min) gegen die **Messwerte**, nicht gegen das eigene Raummodell:

| Prüfung | Regel |
|---|---|
| Heizzeit | geplante Stunden **ohne PV-Überschuss** ≤ 2 × (Halten + Aufheizen) + 1 h. Halten = gemessene Heizstunden je Tag, umgerechnet auf Ziel und Außentemperatur des Plans; Aufheizen = (höchstes Ziel − jetzt) / dauerhafte Erwärmung je Heizstunde |
| Über Ziel aus Netz | ein Heizblock ohne PV-Überschuss beginnt, obwohl der Raum schon > Ziel + 0,5 °C ist (≥ 30 min) |
| Übersteuert | Uli hat den Raum in 24 h ≥ 2× von Hand übersteuert |
| Hinweis (keine Sperre) | Raum heizte zuletzt ≥ 2× so lange wie sonst und lag trotzdem ≥ 50 % der Zeit unter Eco → „Heizleistung, Fühler oder Eco prüfen“ |

**Reaktion:**
- Nur der auffällige Raum: `plan.raeume[].pruefung_ok = false` → `pv-automation` steuert ihn nach dem Regelwerk
  (dieselbe Stelle wie Räume ohne neues Raummodell, `m2 = false`). Mindestens 2 h, danach erneut geprüft.
- Während der Sperre rechnet der Plan den Raum mit seinem jetzigen Zustand (wie „nicht steuerbar“), damit
  Leistungsgrenze und Batterie für die anderen Räume stimmen.
- Protokoll: „Planer-Prüfung: auffällig → Regel-Steuerung übernimmt“ bzw. „wieder unauffällig → Planer steuert“.
- KI › Zu entscheiden: je Raum und Tag eine Info mit Begründung (`quelle = 'planer_pruefung'`).
- **Der Modus wird nie geändert** – den schaltet nur Uli.
- Tagesprüfung (Gegenrechnung 03:00): Braucht der Planer mehr als 10 % + 1 kWh mehr Netz als die Regel-Steuerung bei
  nicht besserem Komfort → Info unter KI › Zu entscheiden.

## 5. Modus

- Etikett im Plan zeigt den Modus, mit dem der Plan gerechnet wurde: „Steuert“ / „Schatten · steuert nicht“ / „Aus“.
- Beim Umschalten auf „Steuern“ oder „Schatten“ rechnet der Planer sofort einen neuen Plan.
- In der Raumliste unter Steuerung › Einzelne Räume stehen auffällige Räume mit Grund.

## 6. Nachgerechnet mit den Daten vom 13.11. (Plan ~13:10)

Vereinfachung: Vorgeschichte der Räume nur als jetzige Temperatur (für den Estrich-Startwert).

| | Heizen | Netz | unter Ziel |
|---|---|---|---|
| alt (`waermeRest` 0,9 symmetrisch) | 69,7 kWh | 46,5 kWh | 17,9 °C·h |
| neu | 32,2 kWh | 19,9 kWh | 28,8 °C·h |

Gemessen heizt das Haus derzeit ~40 kWh am Tag. Der neue Plan ist sparsamer und etwas kühler (mehr °C·h unter Ziel);
wärmer/sparsamer stellt Uli wie bisher mit dem Regler „Sparsamer ↔ wärmer“.

Prüfung des **alten** Plans: auffällig Wirtschaftsraum (5,0 h aus dem Netz über das Ziel), Toilette (3,5 h), Büro,
Zimmer Luca, Kinder Bad, Wohnzimmer (+ 4× übersteuert). Prüfung des **neuen** Plans: nur Wohnzimmer (4× übersteuert,
0,5 h über Ziel bei 5,5 kW-Block); Toilette bekommt den Hinweis „erreicht ihr Ziel nicht“.

## 7. Nebenwirkungen (Regel 08.11.)

1. **Wer liest/schreibt dieselben Daten:** `heizplan.plan.raeume[].pruefung_ok` liest nur `pv-automation`;
   `system_settings.planer_pruefung` schreibt nur der Planer, liest die App. `heizplaner_daten` bekommt zwei Felder
   dazu, die alten bleiben gleich. Ohne SQL 38 laufen Planer und pv-automation wie bisher, nur ohne Prüfung.
2. **Verhalten über Zeit:** Sperre mindestens 2 h, kein Hin- und Herspringen alle 15 min. „Übersteuert“ gilt 24 h
   rückwirkend – ein Raum, den Uli mehrfach übersteuert, bleibt so lange bei der Regel-Steuerung. Plan älter als
   30 min → wie bisher alle Räume Regelwerk.
3. **Leistungsgrenze:** Ein gesperrter Raum heizt nach Regelwerk; der Plan rechnet ihn mit seinem jetzigen Zustand.
   Schaltet die Regel-Steuerung ihn zwischen zwei Plänen ein, kann die Summe kurz über der Grenze liegen (≤ 15 min).
4. **Messwerte mit wenig Daten** (Flur, Waschraum, Kinder Bad: < 5 Heizblöcke): keine Heizzeit-Prüfung, nur die
   anderen Prüfungen.

## 8. Einspielen

1. PR mergen → GitHub-Aktion deployt `heizplaner` und `pv-automation`, Vercel die App.
2. `supabase/SQL/38_planer_pruefung.sql` im SQL-Editor ausführen (oder Claude per Connector nach Freigabe).
3. Prüfen: `select value from system_settings where key = 'planer_pruefung';` und Protokoll „Planer-Prüfung“.
