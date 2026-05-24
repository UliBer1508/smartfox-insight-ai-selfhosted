---
name: KI darf Kernparameter nicht schreiben
description: LOCKED_PARAMS-Set in ai-parameter-advisor und ai-parameter-evaluator blockiert KI-Schreibzugriffe auf Sicherheits-Schwellen
type: constraint
---

Folgende Parameter dürfen NIEMALS von KI/ML-Logik geschrieben oder verändert werden — nur Lesen + Empfehlungen sind erlaubt:

```ts
const LOCKED_PARAMS = new Set<string>([
  'heating_min_battery_soc',
  'pv_surplus_threshold_on',
  'pv_surplus_threshold_off',
  'micro_budget_min_battery_soc',
  'night_start_time',
  'night_end_time',
]);
```

Implementiert in:
- `supabase/functions/ai-parameter-advisor/index.ts` — Filter vor Insert in `ai_parameter_decisions` und vor Auto-Apply auf `heating_settings`.
- `supabase/functions/ai-parameter-evaluator/index.ts` — Auto-Rollback überspringt diese Keys.

Bei jedem neuen Schreibpfad (zukünftige Edge Functions, neue Whitelist-Einträge) MUSS dieser Guard ebenfalls aktiv sein.
