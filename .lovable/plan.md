
# ✅ Effizienz-basierte Raum-Sortierung

## Implementierte Änderungen in `pv-automation/index.ts`

### ML-Features in Budget-Sortierung integriert
- `energy_per_degree_wh` wird aus `latestMlFeatures` für jeden Raum nachgeschlagen
- Geschätzte Heizdauer und Energiebedarf werden pro Raum berechnet und geloggt
- Logging: `[Raum] braucht ~X Wh für +Y°C, geschätzte Dauer: Z Min bei W Watt`

### Neue Sortier-Reihenfolge
1. **Priorität** (1 vor 2 vor 3)
2. **Temperatur-Defizit** (>0.5°C Unterschied → größeres Defizit zuerst)
3. **Effizienz** (niedrigeres `energy_per_degree_wh` zuerst, >100 Wh Unterschied signifikant)
4. **Wartezeit** (längste zuerst als Tiebreaker)

### Effekt
Räume wie Zimmer Luis (345 Wh/°C, ~21 Min) werden vor ineffizienten Räumen wie Wirtschaftsraum (1781 Wh/°C, ~153 Min) aktiviert. Dadurch wird das PV-Budget schneller für weitere Räume frei.
