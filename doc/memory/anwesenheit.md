---
name: Anwesenheit
description: Grundzustand anwesend; Kalender presence_periods = Abwesenheiten → Tagesmodus wait, PV-Überschuss trotzdem Eco → Komfort; fail-safe anwesend
type: constraint
---

**Konzept:** `doc/KONZEPT-ANWESENHEIT-2026-10-28.md` (freigegeben 28.10.2026, Komfort bei Abwesenheit 30.10., **umgedreht 01.11.2026 – §9 gilt**).

**Regel:** Grundzustand **anwesend**. `pv-automation/getPresence()` liest `presence_periods`; jeder Eintrag ist eine
**Abwesenheit** (Haus leer von `start_at` bis `end_at`). Abwesend, solange ein Eintrag läuft und nicht innerhalb von
`heating_settings.presence_lead_hours` (6 h) **vor seinem Ende** liegt (Vorlauf vor der Rückkehr). Abwesend:
- Tagesmodus `wait` (Ladestand-Grenze hat Vorrang, gilt auch nach Sonnenuntergang) → Räume ohne Budget halten „Untergrenze“
- PV-Überschuss heizt wie anwesend: Phase 1 Eco, Phase 2 Komfort (kein Eco-Deckel seit 30.10.2026)
- Nacht unverändert; Übersteuern wirkt

**Fail-safe:** `presence_control_enabled = false`, Tabelle fehlt oder Lesefehler → anwesend. Leerer Kalender = anwesend.

**Bedienung:** Übersicht „Ich bin weg bis …“ / „Ich bin zurück“; Einstellungen › Anwesenheit (Kalender: Abreise, Rückkehr).
**Alexa** (`heizung-muenchen/alexa-heizung`) schreibt noch nach alter Logik – bis zur Umstellung nicht benutzen.

**Nicht einführen ohne neue Messung:** eigene Absenk-Temperatur „Eco abwesend“ (Zeitkonstante ~250–400 h, spart nur 3–11 %).

**Frontend:** `usePresence.computePresence` muss dieselbe Regel rechnen wie das Backend.
