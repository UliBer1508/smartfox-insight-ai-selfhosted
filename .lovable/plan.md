## Problem

Der rote Banner "Nacht-Rückstellung konnte nicht zugestellt werden" bleibt sichtbar, obwohl du längst auf Local-Modus umgestellt hast und die Räume um 8 Uhr auf Eco gegangen sind.

**Ursache 1 — 270 alte Fehler in DB:** Während der Nacht (00:00–05:44) lief noch Cloud-Modus mit erschöpfter Tages-Quota. Alle 16min entstand ein neuer `night_frost_failed`-Eintrag für Raum "Haustür". Diese Fehler sind nie aufgeräumt worden.

**Ursache 2 — Bug im Banner-Filter:** In `ApiErrorBanner.tsx` werden im Local-Modus zwar `quota_exhausted`, `token_expired` und `no_control_channel` ausgeblendet — aber **`night_frost_failed` nicht**. Obwohl das ein reines Cloud-Quota-Symptom ist.

## Fix

### 1. `ApiErrorBanner.tsx` (Zeile 37)

`night_frost_failed` zur Cloud-Only-Liste hinzufügen:

```ts
const cloudOnlyTypes = new Set([
  'quota_exhausted', 'token_expired', 'no_control_channel', 'night_frost_failed'
]);
```

→ Im Local-Modus verschwindet der Banner sofort, auch für rückwirkende alte Einträge.

### 2. DB-Migration: alte Fehler als resolved markieren

```sql
UPDATE api_errors
SET resolved_at = NOW(), is_acknowledged = true
WHERE error_type = 'night_frost_failed'
  AND resolved_at IS NULL
  AND created_at < NOW() - INTERVAL '1 hour';
```

→ Räumt die 270 obsoleten Einträge auf. Falls heute Nacht wieder ein echter Fehler entsteht, wird er normal angezeigt.

## Resultat

- Banner verschwindet sofort
- Künftige `night_frost_failed`-Fehler werden im Local-Modus automatisch unterdrückt (Local-Service queued Commands → kein Quota-Problem möglich)
- Im Cloud-Modus bleibt das Verhalten unverändert: Fehler werden weiter prominent angezeigt