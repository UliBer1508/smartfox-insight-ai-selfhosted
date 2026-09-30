---
name: Tuya Quota Auto-Reset Persistence
description: Tages-/Monats-Reset des Tuya-API-Counters wird in pv-automation sofort persistiert + pg_cron Backup um 00:05/00:10 Wien. Verhindert Henne-Ei-Problem bei erschöpfter Quota.
type: feature
---

**Problem:** `system_settings.tuya_api_quota` hat `today` und `month` Felder. Beim Roll-Over (neuer Tag/Monat) wurde der Counter nur in-memory zurückgesetzt — wenn die Funktion direkt danach in den Quiet Mode ging (Quota erschöpft), wurde der Reset nie in die DB geschrieben. Folge: Counter blieb ewig hoch, System dauerhaft blockiert.

**Fix in `pv-automation/index.ts`:** Nach Roll-Over (Zeilen ~468–488) wird `quotaRolledOver=true` gesetzt und das Reset SOFORT via `update()` persistiert, BEVOR die Erschöpft-Prüfung greift.

**pg_cron Backup (zwei Jobs):**
- `tuya-quota-daily-reset`: `5 23 * * *` UTC → setzt `calls_today=0`, aktualisiert `today` auf Wien-Datum
- `tuya-quota-monthly-reset`: `10 23 1 * *` UTC → setzt `calls_this_month=0`, aktualisiert `month`

Garantiert Reset auch wenn `pv-automation` zur Mitternachts-Zeit nicht läuft. Cron läuft in UTC; 23:05 UTC = 00:05 Wien (Winter) bzw. 01:05 Wien (Sommer) — beides nach Wien-Mitternacht, deshalb sicher.

**Hinweis:** Wenn der Tuya-Cloud-Counter über das Monatslimit läuft (3886/3000 wie am 29.04.2026), wird der Counter trotzdem zurückgesetzt — es ist nur ein Soft-Limit zum Schonen der Quota. Die echte Tuya-Cloud-Quota wird durch tatsächliche API-Fehler erkannt.
