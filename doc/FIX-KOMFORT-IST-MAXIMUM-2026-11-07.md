# Komfort ist das Maximum – „Estrich laden bis“ abgeschafft (07.11.2026)

**Status:** von Uli beauftragt 07.11.2026 („a und b umsetzen“) · SQL 26 ausgeführt · Code zum Upload

## Anlass
KI › Zu entscheiden schlug vor, Zimmer Uli „an Sonnentagen bis 22,5 °C“ zu laden (Wert `pv_boost_max_temp`,
„Estrich laden bis“). „Ja, übernehmen“ wurde abgelehnt: Der Vorschlag lag unter seinem eigenen Mindestwert
(Komfort 23 °C um 10:00). Bei der Klärung kam heraus, dass der Wert dem Konzept widerspricht.

## Grundsatz (Uli, 07.11.2026)
- **Komfort ist das Maximum.** Bei PV-Überschuss erst alle Räume auf Eco, dann Raum für Raum nach Priorität auf Komfort.
- **Der Estrich ist der Speicher** – durch das Heizen bis Komfort. Dafür gibt es keinen eigenen Wert.
- **Über Komfort nur, wenn alle Räume auf Komfort sind.**
- Nicht verbrauchter Überschuss gehört dem nächsten Raum in der Priorität.

## Was der alte Wert tat (Lovable-Zeit)
`pv_boost_max_temp` heizte **nicht** über Komfort – die Schlussbremse in `pv-automation` („Temperatur-Deckelung“)
setzt nie mehr als Komfort, außer alle Räume sind auf Komfort, Batterie ≥ 95 % und kein Warmwasser (dann Komfort + 1).
Er steuerte den „Battery-Full-Override“: Batterie ≥ 95 % und ≥ 3000 W Einspeisung → ein Raum auf Komfort geht nicht
zurück auf Eco, solange er unter dem Wert liegt (ohne Wert: Komfort + 1,5). Das galt **unabhängig von anderen Räumen**
– ein voller Raum hielt Komfort, während Räume mit niedrigerer Priorität noch unter Komfort lagen.

## Änderungen
| Teil | Änderung |
|---|---|
| `pv-automation` | Override nur noch, wenn **alle Räume auf Komfort** sind (+ Batterie ≥ 95 %, Einspeisung ≥ 3000 W, Prognose ≥ 5 kWh); dann bleiben die Räume auf Komfort statt Eco. Kein Raumwert mehr. Schlussbremse (Komfort / Super-Komfort) unverändert. |
| `ki-tagesanalyse` | Regel 3 „Estrich laden bis“ entfernt. |
| `heizplaner` | Obergrenze je Raum = Komfort (vorher max(Komfort, Estrich-Wert)). |
| App: Einstellungen › Räume | Hinweis „Bei voller Batterie: Komfort halten bis …“ ersetzt durch: höchstens bis Komfort, darüber nur wenn alle Räume auf Komfort. |
| App: Übersicht | „PV max …“ entfernt. |
| App: `useKiVorschlaege.ts` | Grenzen für Raumwerte (Untergrenze) aus den **aktuellen** Raumwerten, nicht aus dem Stand von 10:00. |
| SQL 26 | Whitelist `pv_boost_max_temp` aus, offene Vorschläge dazu geschlossen. Spalte bleibt, wird nicht mehr gelesen. |

## Befund b: Warum Kinder Bad und Wirtschaftsraum an Sonnentagen leer ausgingen
Protokoll › Ereignisse, 04.11. und 06.11.: Zwei Entscheidungswege überschreiben sich im Wechsel.
- **06.11.**, Kinder Bad, 12:03–14:03: „Phase 1: Eco 21 °C (Budget OK)“ → 5 Minuten später „Tagesmodus wait: Sonnentag …
  hält Untergrenze 20,5 °C“ → wieder Phase 1 … rund zehnmal. Der Raum kam nie über 20,5 °C.
- **06.11.**, Wirtschaftsraum: 12:38 „Phase 2: Komfort 23 °C“, heizt 62 min bis 21,1 °C, 13:03 „Tagesmodus wait … hält
  Untergrenze 19 °C“ → abgebrochen.
- **04.11.**: Wirtschaftsraum den ganzen Sonnentag 17–18 °C mit „Tagesmodus … Grenze 1000/2000/4000 W erreicht → wartet“ –
  Heizen mit Sonne wurde gegen die Netz-Grenze gezählt.
- Auffällig: Budgetzahlen wie „Eco-Phase (3400/22957 W)“ – mehr als die Anlage liefern kann.

Ursache: Räume ohne „echtes Budget“ in einem Lauf fallen in den Tagesmodus (Ziel Untergrenze); im nächsten Lauf bekommen
sie wieder Budget. Ergebnis: Pendeln, der Überschuss wird nicht stabil an die nächsten Räume weitergegeben.
**Noch nicht geändert** – erst Konzept mit Uli (Grundsatz: erst Konzept, dann Code).
