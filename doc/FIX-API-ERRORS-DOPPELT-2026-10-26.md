# FIX: Offline-Thermostat erzeugt alle 5 Minuten einen neuen Fehler

**Datum:** 26. Oktober 2026
**Supabase:** `pflnniklvqbwjwrjswaz`
**SQL:** `supabase/SQL/05_api_errors_dedupe.sql` (im SQL-Editor ausführen)
**Betroffen:** nur Datenbank. Kein Frontend, kein Neustart des Dienstes.

## Befund

```
room_name       | error_type     | source     | count | min                 | max
Wirtschaftsraum | device_offline | tuya-local | 8     | 26.10. 10:43:58 UTC | 11:19:00 UTC
```

Acht offene Einträge in 35 Minuten – einer je Sync-Zyklus. Der Fix vom 16.09. (`logDeviceError`:
erst offenen Eintrag suchen, dann nur `retry_count` erhöhen) greift nicht.

## Ursache: anon darf api_errors nicht lesen

Policies auf `api_errors` für `anon`: **INSERT** und **UPDATE** – aber **keine SELECT**. Die Suche
des Dienstes nach einem offenen Eintrag liefert deshalb still eine leere Liste (RLS), und er fügt
neu ein. Weil Postgres bei UPDATE mit WHERE auch die SELECT-Policies anwendet, laufen auch die
Aufräum-UPDATEs des Dienstes ins Leere; das Auflösen übernimmt `auto-resolve-api-errors`.

Dasselbe Muster wie bei den Heizzyklen (`FIX-HEIZZYKLEN-TRIGGER-2026-10-26.md`): Der Dienst
arbeitet mit dem öffentlichen anon-Schlüssel, ein fehlendes Leserecht fällt nicht auf.

## Lösung

BEFORE-INSERT-Trigger `trg_api_errors_dedupe` (SECURITY DEFINER): Existiert für dasselbe Gerät
(`device_id`) und denselben `error_type` schon ein offener Eintrag, wird dort `retry_count` erhöht
und die Meldung aktualisiert; der neue Eintrag entfällt. Einträge ohne `device_id` (z. B.
pv-automation, Watchdogs) sind nicht betroffen. Keine SELECT-Policy für anon – der Schlüssel ist
öffentlich, und Fehlermeldungen enthalten Gerätekennungen.

Einmalig schließt das Skript bestehende Doppelte; je Gerät und Fehlertyp bleibt der neueste offen.

Getestet gegen PostgreSQL 16: 8 offene → 1; neuer gleicher Fehler → retry_count 1, kein neuer
Eintrag; anderer Fehlertyp und Einträge ohne Gerät unverändert.

Rückweg: `drop trigger if exists trg_api_errors_dedupe on public.api_errors;`

## Gelernt

Wenn ein Dienst mit dem anon-Schlüssel „erst lesen, dann schreiben“ macht, muss das Lesen erlaubt
sein – sonst schreibt er still jedes Mal neu. Bei neuen Dienst-Funktionen alle drei Rechte prüfen
(SELECT, INSERT, UPDATE), nicht nur das Schreiben.
