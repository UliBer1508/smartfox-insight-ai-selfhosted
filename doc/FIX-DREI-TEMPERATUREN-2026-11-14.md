# FIX: Drei Temperaturen je Raum – Min, Normal, PV-Max (14.11.2026)

## Anlass

In der Nacht zum 14.11.2026 lagen Bad Uli und Haustür unter ihrem Nachtwert (21 °C). Die Thermostate zeigten 18,5 °C bzw. 19 °C. Diese Werte sind keine Sollwerte. Die Automatik stellt so das Thermostat aus, wenn ein Raum warten muss („Grenze 3000 W belegt → wartet“).

Uli: „Die Räume dürfen nicht unter die Min-Temperatur fallen. Wozu vier Temperaturen? Wir brauchen Min, Normal und bei PV-Überschuss.“

## Entscheidung (Uli, 14.11.2026)

Je Raum gibt es nur noch drei Temperaturen:

| Neu | Spalte | Bedeutung | früher |
|---|---|---|---|
| **Min** | `wait_min_temp` | darf nie unterschritten werden, Tag und Nacht | „Untergrenze“ und „Nacht“ |
| **Normal** | `eco_temp` | Ziel tagsüber, ohne Sonne auch aus dem Netz | „Eco“ |
| **PV-Max** | `comfort_temp` | bis hierhin mit PV-Überschuss (Estrich-Speicher) | „Komfort“ |

Nachts wird Min gehalten. Das entspricht der Abendlogik vom 06.11.2026: kein Normal aus der Batterie.

Offen und **erst nach diesem Umbau** zu besprechen:

1. Darf ein Raum unter Min immer heizen, auch über der Leistungsgrenze? Damit würde „Grenze gilt immer“ vom 06.11. für diesen Fall zurückgenommen.
2. Sollen Räume, die Richtung Normal oder PV-Max heizen, für Räume unter Min abgeschaltet werden?
3. Vorlauf: Die Heizung startet heute erst, wenn der Raum schon unter Min ist. Weil der Estrich träge ist, muss sie kurz vorher anlaufen.

## Umsetzung

**Datenbank (`supabase/SQL/39_drei_temperaturen.sql`)**
- `night_temp` bleibt als Spalte, weil sie von pv-automation, heizplaner, compute-daily-score und Oberfläche gelesen wird. Ein Trigger `z_trg_min_gleich_nacht` hält sie immer gleich `wait_min_temp`. Ändert alter Code nur `night_temp`, wird der Wert als neuer Min übernommen.
- Daten: Min = höherer der beiden bisherigen Werte. Nachts galt schon max(Nacht, Untergrenze), damit wird kein Raum kälter. Am 14.11. betraf das nur Toilette Eingang (21 → 21,5).
- Das Protokoll (`trg_protokoll_raum`) nennt die Werte jetzt Min / Normal / PV-Max und protokolliert `night_temp` nicht mehr doppelt.
- Der Whitelist-Text für KI-Vorschläge bei `wait_min_temp` wurde angepasst.

**Oberfläche**
- Einstellungen › Räume: drei Felder Min / Normal / PV-Max, Prüfung Min ≤ Normal ≤ PV-Max, auch im Dialog „Neuer Raum“.
- Übersicht: Raumzeile und Tagesmodus-Texte mit den neuen Namen.

**Edge Functions (nur Texte, keine Logik)**
- pv-automation: Die Begründungen sagen „Min“ statt „Nachtwert“ oder „Untergrenze“.
- ki-tagesanalyse: Label und Texte „Min“.

## Nebenwirkungen geprüft

- **Leser von `night_temp`:** pv-automation (Nachtziel = max(night_temp, wait_min_temp)), heizplaner (`nachtZiel = max(nacht, unter)`), compute-daily-score, RoomStatusTable, useActiveHeatingRooms. Durch den Trigger bekommen alle Min. Ihre Logik ändert sich nicht, weil sie schon den höheren Wert genommen haben.
- **Schreiber:** Oberfläche, KI-Vorschläge (nur `wait_min_temp` auf der Whitelist; `night_temp` ist nicht vorschlagsfähig). Der Trigger läuft nach `protect_rooms_sensitive_columns`, weil BEFORE-Trigger alphabetisch laufen.
- **Tagsüber:** Untergrenze war schon Min. Keine Änderung.
- **Eco/Komfort in Planer, Tagesnote und KI-Texten:** heißen dort weiter so; in den Einstellungen steht der alte Name als Tooltip. Eine komplette Umbenennung ist eine eigene Entscheidung.

## Einspielen

1. SQL 39 im Supabase-SQL-Editor ausführen (am 14.11.2026 bereits durch Claude ausgeführt).
2. PR mergen → Vercel deployt die Oberfläche.
3. Auf dem Österreich-PC: `git pull`, dann `supabase functions deploy pv-automation` und `supabase functions deploy ki-tagesanalyse`.
