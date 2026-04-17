

## Problem: Räume heizen nicht trotz 2,1 kW Export-Überschuss

### Diagnose aus den Daten

**Aktuelle Lage (13:00 Wien):**
- PV: 10,4 kW | Verbrauch: 7,9 kW | Batterie: 99% (voll!) | Export: 2,1 kW
- pv-automation berechnet korrekt: alle Räume sollen auf Eco (20°C/19°C)
- Aber: `is_heating: false` bei ALLEN 12 Räumen
- Ziel-Temperaturen sind in der DB schon korrekt gesetzt (20°C bzw. 19°C)

**Zwei kritische Blocker:**

### Blocker 1: `mode: 'home'` schlägt mit Error 2008 fehl
Aus den Logs: `[Tuya] xxx mode->home: success=false, code=2008` für **alle 12 Geräte**. Der separate `mode`-Call funktioniert auf den TGP508 ebenfalls nicht (Error 2008 = "command not supported"). Die Thermostate bleiben damit in ihrem internen Programm-Modus und ignorieren remote-Temperaturen.

→ **Code `mode: 'home'` ist auf TGP508 generell nicht unterstützt** — weder kombiniert noch separat. Der Versuch verbraucht nur Quota (12 Calls/Stunde verschwendet).

### Blocker 2: Manueller Override seit Wochen aktiv
Alle Räume haben `manual_override_until` in der **Zukunft** (z.B. `2026-04-12 15:43`, sogar bis `2026-03-19 11:44` — beide Daten liegen in der Vergangenheit, aber durch das fiktive Datum 2026 sind sie für die Automation "aktiv"). Die pv-automation respektiert manuelle Overrides und blockiert dann Temperatur-Änderungen.

Aus den Logs sehe ich aber: pv-automation versucht trotzdem zu setzen ("PV-HEIZEN - ☀️ Phase 1: Eco 20°C") — also wirkt der Override hier nicht direkt blockierend, sondern die Tuya-Calls schlagen aus anderen Gründen fehl bzw. die Quota ist erschöpft (47/33).

### Eigentliche Kernursache: Quota erschöpft + falscher Mode-Code

Die pv-automation schreibt zwar `target_temp` in die DB, aber:
1. **Quota 47/33** → keine Cloud-Calls mehr möglich
2. **Lokaler Collector offline** → keine Pending-Commands verarbeitet (Tabelle ist leer, wurden also schon konsumiert oder nie geschrieben)
3. **`mode: 'home'` Error 2008** → selbst wenn Quota frei wäre, würde der Mode-Sync versagen

### Lösung

**1. Mode-Sync entfernen (TGP508 unterstützt es nicht)**
- In `pv-automation/index.ts` den stündlichen `setDeviceModeHome`-Block entfernen
- Spart 12 Calls/Stunde Quota
- Mode-Wechsel muss anders gelöst werden (z.B. via lokalem Collector mit DPS-Code, der funktioniert)

**2. Quota-Limit anheben**
- Aktuell 33 Calls/Tag ist viel zu niedrig für 12 Thermostate
- Tuya Free Tier erlaubt ~100k/Monat → realistisch 200-500/Tag möglich
- Empfehlung: `tuya_daily_call_limit` in `system_settings` auf 200 setzen

**3. Manuelle Overrides löschen**
- Alle `manual_override_until` auf NULL setzen (sind veraltet, blockieren womöglich später)

**4. Thermostat-Commands für lokalen Collector queuen (Fallback)**
- Da Cloud-Quota voll ist: `set_temp` Commands für alle Räume in `thermostat_commands` einfügen
- Falls lokaler Collector wieder online geht, werden sie verarbeitet

### Reihenfolge der Umsetzung
1. DB-Migration: Override-Felder leeren + Quota-Limit erhöhen
2. Edge Function `pv-automation` anpassen: Mode-Sync-Block entfernen
3. Thermostat-Commands queuen für sofortige Wirkung sobald Collector läuft
4. Test: nächster pv-automation Zyklus sollte Cloud-Calls erfolgreich absetzen

