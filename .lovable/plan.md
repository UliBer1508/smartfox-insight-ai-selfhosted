## Ziel

Im **Lokal-Modus** (`tuya_control_mode = 'local'`) sollen Cloud-spezifische Warn-Banner nicht mehr erscheinen, da sie irrelevant sind.

## Cloud-spezifische Banner, die im Lokal-Modus ausgeblendet werden

| Banner | Datei | Grund |
|---|---|---|
| Quota erschöpft | `ApiErrorBanner.tsx` (`quota_exhausted`) | Kein Cloud-Call → keine Quota |
| Token abgelaufen | `ApiErrorBanner.tsx` (`token_expired`) | Cloud-Token irrelevant |
| Kein Steuerkanal | `ApiErrorBanner.tsx` (`no_control_channel`) | Bezieht sich auf Cloud-Quota erschöpft + Local down |
| Tuya Subscription Ablauf | `TuyaSubscriptionAlert.tsx` | Cloud-Subscription irrelevant |

Behalten bleiben (auch im Lokal-Modus relevant):
- `device_offline` – Thermostat per LAN nicht erreichbar
- `night_frost_failed` – Sicherheits-Rückstellung gescheitert (auch lokal kritisch)
- Sonstige API-Fehler aus dem lokalen Service (`source='tuya-local'`)

## Umsetzung

1. `ApiErrorBanner.tsx`
   - `useControlMode()` einbinden
   - Filter: bei `mode === 'local'` Errors mit `error_type ∈ {quota_exhausted, token_expired, no_control_channel}` rauswerfen
   - Wenn nach Filter keine Errors übrig → `null`

2. `HeatingDashboard.tsx` (oder wo `TuyaSubscriptionAlert` gerendert wird)
   - `useControlMode()` checken und `TuyaSubscriptionAlert` nur rendern wenn `mode === 'cloud'`

3. Keine DB-Änderungen, keine Edge-Function-Änderungen.

## Test

- Toggle in Settings cloud↔local: Banner verschwinden/erscheinen sofort (staleTime 30s, ggf. invalidate triggert es schon)
- Existierende Quota-Errors in DB werden im Lokal-Modus ignoriert, ohne resolved zu werden (bleiben für Audit)
