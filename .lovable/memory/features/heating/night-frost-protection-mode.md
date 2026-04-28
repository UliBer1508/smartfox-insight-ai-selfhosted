---
name: Night Frost Protection Mode
description: Nacht-Stille-Modus 20:00-08:00 — pro Nacht EIN einziger Tuya-Push beim Übergang, danach 0 Calls bis Eco-Start. Gate via system_settings.night_frost_last_pushed.
type: feature
---

**Nacht-Stille-Modus (gehärtet):**

Ab `night_start_time` (Default 20:00 Wien) bis `night_end_time` (Default 08:00 Wien) führt `pv-automation` pro Nacht **genau EINEN** Tuya-Cloud-Push aus, danach werden alle weiteren Iterationen durch ein Gate sofort beendet (Quiet Mode, kein Cloud-Call, kein API-Error-Spam).

**Gate-Mechanik:**
- Settings-Key: `system_settings.night_frost_last_pushed`
- Wert: `{ night: 'YYYY-MM-DD', pushed_at, rooms, successes, failures, mode }`
- `nightKey` = Datum des Nacht-Beginns (Wien). Wenn aktuelle Wien-Zeit < `night_end_time`, gehört sie zur Nacht des Vortages.
- Gate-Check vor jeder Raum-Iteration: wenn `lastPushedNight === nightKey` → sofortiger Return.

**Modus `frost_only` (Default):**
- Einmalig: alle Räume mit `target_temp > 6°C` werden auf `5°C` (FROST_TEMP) gesetzt.
- Sind beim Start alle bereits ≤ 6°C → Gate wird trotzdem gesetzt, kein Push.
- **KEIN periodischer 30-Min-Resync mehr** (alte Logik verbrannte ~360 Calls/Nacht). TGP508 halten den Sollwert; etwaige Drift wird morgens beim Eco-Start korrigiert.
- Bei Fehlschlag (Quota/no_control_channel): API-Error wird nur 1× pro Nacht geloggt, Gate trotzdem gesetzt.

**Modus `maintain`:**
- Räume werden auf `night_temp` (raum-individuell oder global) gesetzt — wieder einmalig.
- Gleiche Gate-Logik wie `frost_only`.

**Auto-Reset am Morgen:**
- Sobald `night_end_time` überschritten wird, ändert sich `nightKey` → Gate gilt nicht mehr → nächster Nacht-Push (am kommenden Abend) läuft sauber.
- Tuya-Tagescounter (`tuya_api_quota.calls_today`) wird durch die `today`-Datumslogik ohnehin um 00:00 UTC zurückgesetzt.

**Effekt:**
- Vorher: ~360 Cloud-Calls/Nacht (12 Räume × 30 Iterationen Resync) → Tagesquota schon morgens erschöpft.
- Nachher: 0–12 Calls/Nacht (nur falls Räume noch über Frostschutz/Nachttemp standen). Tageskontingent bleibt für den Tagbetrieb komplett verfügbar.
