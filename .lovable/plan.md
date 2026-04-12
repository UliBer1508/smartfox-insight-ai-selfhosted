

# Fix: PV-Priority Schwellenwert senken + Quota-Reset

## Problem
1. PV-Priority-Schwelle 1500W ist zu hoch → System kann trotz 1200W Export + voller Batterie nicht heizen
2. Quota heute bereits bei 61 Calls (vor dem Fix) → System komplett blockiert
3. SOC-Bedingung (≥90%) ist erfüllt, aber Export-Bedingung scheitert

## Änderungen

### A. PV-Priority Schwelle anpassen (`pv-automation/index.ts`)
- Export-Schwelle von 1500W auf **500W** senken WENN Batterie ≥ 95%
- Bei Batterie 90-95%: Schwelle bei 1000W
- Bei Batterie < 90%: keine PV-Priority (Batterie hat Vorrang)

```text
SOC ≥ 95% + Export > 500W  → PV-Priority ✅
SOC ≥ 90% + Export > 1000W → PV-Priority ✅  
SOC < 90%                  → keine PV-Priority
```

### B. Quota-Tageszähler zurücksetzen
- Per DB-Update den `calls_today` Counter auf 0 setzen, damit das System heute noch arbeiten kann
- Das dynamische Limit (26) ist durch den alten Verbrauch verzerrt

### C. PV-Priority Calls erhöhen
- Von 3 zurück auf **5 Calls** bei PV-Priority, da mit den anderen Einsparungen (2h Sync-Intervall) das Gesamtbudget trotzdem passt

## Erwartetes Verhalten nach Fix
```text
Aktuell: 1220W Export, SOC 98.4%
→ SOC ≥ 95% + Export > 500W → PV-Priority AKTIV
→ System kann bis zu 5 API-Calls machen
→ Räume nach Priorität heizen: Bad Uli, Zimmer Uli, Kinder Bad...
```

## Betroffene Dateien
- `supabase/functions/pv-automation/index.ts` — PV-Priority Bedingung + Call-Limit
- DB-Update: `system_settings` Quota-Reset

