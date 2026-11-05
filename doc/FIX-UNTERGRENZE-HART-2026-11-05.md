# Fix: Untergrenze ist hart – kein „Warten unter Ist“ mehr (05.11.2026)

**Betrifft:** `supabase/functions/pv-automation/index.ts` (`allocateDayTargets`), `src/components/overview/HouseOverview.tsx`

## Beobachtung
05.11.2026, 11:45: Zimmer Uli Ist 20,5 °C, **Soll 20,0 °C**, Untergrenze 21 °C, Eco 21 °C.
PV 4,7 kW, davon 3,4 kW in die Batterie (SOC 32 % < 75 %), Netz ≈ 0 → Tagesmodus **Batterie-Schutz**.

Protokoll:
```
11:08  → 19,5 °C  battery_gate: unter Notfall-Grenze, Grenze 1000W erreicht → wartet
11:23  → 20,0 °C  battery_gate: unter Notfall-Grenze, Grenze 1000W erreicht → wartet
```

## Ursache
In `allocateDayTargets` (Pass 1) wurde ein Raum unter der Untergrenze nur geheizt, solange die
Leistungsgrenze (Batterie-Schutz `battery_gate_max_power_w` = 1000 W, sonst `max_grid_heating_power_w`)
noch Platz hatte. Sonst bekam er `holdBelow(cur) = abgerundet(Ist − 0,5 °C)` – der Sollwert lief mit
der Raumtemperatur nach unten mit. Damit gab es keine Untergrenze mehr, im Widerspruch zu
„Untergrenze ist hart“ (Konzept Raummodell §3.2, 02.11.2026).

## Änderung
- Pass 1: Räume unter der Untergrenze werden **immer** bis zur Untergrenze geheizt. Ihre Leistung wird
  mitgezählt; steht die Summe über der Grenze, steht das in der Begründung („Untergrenze geht vor“).
- Pass 2 (Eco aus dem Netz) bleibt begrenzt: Ein Raum bekommt Eco nur, solange unter der Grenze Leistung frei ist.
- `holdBelow` entfernt. Ein Tages-Sollwert liegt damit nie mehr unter der Untergrenze.
- Begründungstexte lesbarer („hält Untergrenze 21 °C“, „heizt bis Untergrenze“).
- Raumkarte: Zeile „Automatik: …“ aus `system_settings.heating_day_mode.rooms[].why` (nur frisch, nur im
  Zustand „Normal“), Untergrenze in der Wertezeile.

## Folge
Im Batterie-Schutz können jetzt mehr als 1000 W gleichzeitig heizen, wenn mehrere Räume unter ihrer
Untergrenze sind. Das ist gewollt (Uli 02.11.: Räume sollen nicht auskühlen). Wer weniger Batterie-Verbrauch
will, senkt die Untergrenze des Raums, nicht die Grenze.

## Einspielen
`supabase functions deploy pv-automation` (bzw. GitHub-Aktion), Frontend über Vercel.
