# FIX: Planer rechnete keine Pläne mehr (Timeout) – 14.11.2026

## Befund

Uli stellte am 14.11. um 07:58 auf „Steuern“, gesteuert hat aber weiter das Regelwerk. Im Log der pv-automation stand „Plan 298 min alt (> 30) → Regelwerk“.

- Der letzte Plan stammte vom 14.11. 03:02. Seit 13.11. 16:00 brach der Heizplaner fast jeden Lauf ab: `heizplaner_daten: canceling statement due to statement timeout`.
- Die Edge Function ruft `heizplaner_daten()` über PostgREST auf. Dort gilt `statement_timeout = 8 s` (Rolle `authenticator`).
- Gemessen: `raum_messwerte(14)` aus SQL 38 (Plan-Prüfung, 13.11.) braucht allein 8–10 s. Der Rest von `heizplaner_daten` braucht unter 1 s.
- Ohne frischen Plan fällt „Steuern“ automatisch auf das Regelwerk zurück. Deshalb hat niemand den Fehler bemerkt, auch Uli nicht. Der Planer lief faktisch seit dem 13.11. nachmittags nicht.

## Lösung (SQL 41, am 14.11.2026 ausgeführt)

- `raum_messwerte_cache_aktualisieren()` berechnet die Messwerte und legt sie in `system_settings.raum_messwerte_cache` ab.
- pg_cron `raum-messwerte-cache` ruft sie alle 30 min auf (Minute 7 und 37, Rolle postgres, ohne 8-s-Limit).
- `heizplaner_daten()` liest nur noch den Cache. Gemessen 0,06 s statt 9 s.
- Die Messwerte sind 14-Tage-Statistiken. 30 Minuten Verzögerung ändern daran nichts.

## Nebenwirkungen

- Nur der Heizplaner liest `heizplaner_daten`.
- Fehlt der Cache, kommen leere Messwerte. Die Plan-Prüfung prüft dann nichts, der Plan wird trotzdem gerechnet.
- Offen: Die Systemstatus-Anzeige hat den Ausfall nicht gemeldet. Ein Plan, der älter als 30 min ist, sollte als Störung erscheinen.
