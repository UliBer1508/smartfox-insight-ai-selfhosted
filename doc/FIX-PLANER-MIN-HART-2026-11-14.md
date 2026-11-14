# FIX: Planer hält Min hart (14.11.2026)

## Anlass

Uli, 14.11.2026: „Wir haben definiert, dass Min die Untergrenze ist. Keinen Wert darunter. Die Steuerung hat die
Aufgabe, mit den Werten aus der Vergangenheit und den PV-Werten für den Tag das Optimum zu erzielen.“

Befund: Im Modus „Steuern“ entscheidet der Planer (`doc/KONZEPT-PLANER-2026-11-06.md`). Er hielt aber nicht Min, sondern
Min − `planer_sicherheit_abstand` (1,5 °C). Zwischen Min − 1,5 und Min war Unterschreiten nur eine Kostenfrage. Die
Min-Regel vom selben Morgen (`doc/FIX-MIN-VORRANG-2026-11-14.md`) wirkt nur in der Regel-Steuerung, also im Rückfall.

## Nachrechnung (14.11.2026, Plan ab 11:40 für 24 h, echte Temperaturen und PV-Vorhersage)

| Variante | Heizen | Netz | unter Min | tiefster Raum unter Min |
|---|---|---|---|---|
| **A** Min hart (Abstand 0), Grenze 3,75 kW | 46,8 kWh | 22,8 kWh | 2,7 °C·h | −0,4 °C |
| B wie A, für Min bis 6 kW | 46,8 kWh | 24,8 kWh | 2,7 °C·h | −0,4 °C |
| C wie B, Vorlauf 0,2 °C | 50,2 kWh | 28,2 kWh | 2,7 °C·h | −0,4 °C |
| D wie C, Strafe 100 statt 30 | 50,2 kWh | 28,2 kWh | 2,7 °C·h | −0,4 °C |

- Die 2,7 °C·h und −0,4 °C stammen allein vom Kinder Bad, dessen Thermostat keine Befehle annimmt (20,6 °C bei Min 21).
  Alle steuerbaren Räume bleiben im Plan auf oder über Min.
- Deckel und Vorlauf bringen keine bessere Temperatur, kosten 2 bzw. 5,4 kWh Netz am Tag: Der Planer sieht im Raummodell
  voraus, wann ein Raum Min erreicht, und heizt rechtzeitig.
- Die Rückrechnung auf den 13.11. ist nicht aussagekräftig: Mit den heutigen Min-Werten (21 °C) lagen die Räume um
  Mitternacht schon 1–2 °C darunter, jeder Plan muss erst das ganze Haus aufheizen (bis 90 kWh am Tag).
- Gerechnet mit einer Testfunktion `heizplaner-test` (schreibt nichts) – im Supabase-Dashboard löschen.

**Entscheidung Uli (14.11.2026): Variante A.**

## Umsetzung

- `heizplaner/rechnen.ts`: Strafe `sicher` (30 je °C·h, gewichtet nach Priorität) gilt ab Min, nicht mehr ab
  Min − `planer_sicherheit_abstand`. Kein Deckel, kein Vorlauf im Planer.
- `pv-automation` (`planerSollwert`): Sicherheitsnetz bei Min selbst – fällt ein Raum trotz Plan unter Min (Modellfehler),
  heizt er sofort.
- Auto-Steuerung: Regler „Sicherheit unter Untergrenze“ entfernt; Texte „Min hält der Planer immer“.
- Einstellungen › Haus: „Regel-Steuerung: Höchstleistung für Min“ (6000 W) und „Vorlauf vor Min“ (0,2 °C) gelten nur für
  die Regel-Steuerung (Schatten, oder kein Plan ≤ 30 min). „Planer: zusätzlich unter Untergrenze“ entfällt aus der App.
- `heating_settings.planer_sicherheit_abstand` am 14.11. um 08:35 auf 0 gesetzt, seitdem ohne Wirkung (SQL 42 Kommentar).

## Nebenwirkungen

- Plan-Prüfung (`pruefung.ts`): Der Planer heizt nun eher rechtzeitig vor Min – die Heizzeit-Prüfung kann Räume öfter als
  „heizt länger als nötig“ markieren; dann steuert die Regel-Steuerung (mit Min-Vorrang) den Raum. Beobachten.
- Gegenrechnung 03:00: „unter Untergrenze“ zählt weiter ab Min.
- Kinder Bad: Solange das Thermostat keine Befehle annimmt, hält keine Steuerung dort Min.

## Einspielen

PR mergen → GitHub-Aktion deployt `heizplaner` und `pv-automation`, Vercel die App. SQL 42 ist ausgeführt (setzt SQL 41 aus PR #59 voraus).
