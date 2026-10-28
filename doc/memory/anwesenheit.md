---
name: Anwesenheit
description: Kalender presence_periods; außerhalb (inkl. Vorlauf) gilt abwesend → Tagesmodus wait, kein Komfort, höchstens Eco; fail-safe anwesend
type: constraint
---

**Konzept:** `doc/KONZEPT-ANWESENHEIT-2026-10-28.md` (freigegeben von Uli am 28.10.2026).

**Regel:** `pv-automation/getPresence()` liest `presence_periods` (Zeiträume, in denen jemand da ist).
Läuft ein Eintrag oder beginnt er innerhalb von `heating_settings.presence_lead_hours` (6 h) → anwesend,
sonst abwesend. Abwesend:
- Tagesmodus `wait` (Batterie-Gate hat Vorrang, gilt auch nach Sonnenuntergang) → Räume ohne Budget halten „Ohne PV“
- Phase 2 (Komfort) übersprungen, Temperatur-Deckelung höchstens Eco
- PV-Überschuss heizt weiter bis Eco; Nacht unverändert; Übersteuern wirkt

**Fail-safe:** `presence_control_enabled = false`, Tabelle fehlt oder Lesefehler → anwesend (Verhalten vor 28.10.2026).

**Nicht einführen ohne neue Messung:** eigene Absenk-Temperatur „Eco abwesend“. Gemessen 28.10.: Zeitkonstante
~250–400 h, tiefere Temperatur spart nur 3–11 % – der Hebel ist kein Netz-Eco bei leerem Haus.

**Frontend:** `usePresence.computePresence` muss dieselbe Regel rechnen wie das Backend.
