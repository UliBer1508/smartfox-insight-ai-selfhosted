
Ziel:
Den 6-kW-Verbrauch stoppen, indem die Automations-Heartbeat-Calls wieder autorisiert werden und das 2-kW-Budget wieder greift.

Was ich geprüft habe:
- `energy_readings` zeigt realen Verbrauch von ca. **5.9–6.2 kW** (kein UI-Anzeigeproblem).
- In `rooms` heizen aktuell **7 von 12** Thermostaten gleichzeitig (geschätzt ~5.5 kW Heizlast), viele mit `target_temp=20`.
- `heating_settings.max_grid_heating_power_w = 2000` ist korrekt gesetzt, wird aber praktisch nicht durchgesetzt.
- Cron-Heartbeat (`*/2 min` auf `/functions/v1/pv-automation/check`) liefert in `net._http_response` fortlaufend **401 Unauthorized**.
- `pv-automation`-Logs zeigen nur Boot/Shutdown, keine Entscheidungslogs → Steuerlogik läuft nicht durch.

Wahrscheinliche Hauptursache:
- Die manuelle Auth-Validierung in mehreren Functions akzeptiert entweder:
  1) exakten String-Match auf `SUPABASE_ANON_KEY`/`SERVICE_ROLE`, oder  
  2) JWT mit `claims.sub`.
- Interne Calls (Cron/Collector) kommen teils als anon/publishable Token ohne `sub` und fallen dann fälschlich auf 401.

Änderungsvorschlag (Implementierung):
1) Einheitlichen Auth-Fix in betroffenen Functions
- Dateien:
  - `supabase/functions/pv-automation/index.ts`
  - `supabase/functions/tuya-control/index.ts`
  - `supabase/functions/apply-recommendations/index.ts`
  - `supabase/functions/analyze-patterns/index.ts`
- Logik:
  - Weiterhin `Authorization: Bearer ...` Pflicht.
  - Exakte Allowlist erweitern: `service_role`, `anon`, **publishable key** (falls vorhanden).
  - Bei `getClaims(...)` nicht nur `sub` akzeptieren, sondern auch gültige Token mit `role in ('anon','authenticated','service_role')`.
  - Bei Ablehnung strukturierte Logs (ohne Token-Leak): Pfad, role, hasSub.

2) Sofort-Wiederanlauf sicherstellen
- Nach Deploy einen erzwungenen `pv-automation/check`-Lauf auslösen (oder auf den nächsten 2‑Minuten-Cron warten).
- Erwartung: Räume mit Budget-Pause werden auf Nacht-/Eco-Ziel gedrückt, paralleles Heizen sinkt deutlich.

3) Falls danach noch 401 auftreten (Fallback)
- Cron-Header für Job 1 auf den aktuellen internen Schlüssel aktualisieren (DB-Migration für `cron.job` command).
- Optional denselben Check für Collector-Konfiguration dokumentieren.

Technische Details:
- Keine Schema-Änderung an Tabellen nötig.
- Keine RLS-Änderung nötig.
- Sicherheitsniveau bleibt erhalten: Token wird weiterhin kryptografisch via Claims geprüft; es wird nur die interne Rollenvalidierung korrekt gemacht.
- Der 6-kW-Verbrauch ist aktuell eine Folge von ausbleibender Automation, nicht von fehlerhafter Verbrauchsberechnung.

Validierung (End-to-End):
1) `net._http_response`: innerhalb von 10 Minuten keine neuen 401 für `pv-automation/check`.
2) `pv-automation`-Logs: wieder regelmäßige Entscheidungslogs statt nur Boot/Shutdown.
3) `rooms`: `last_auto_change` aktualisiert sich wieder im 2‑Minuten-Takt.
4) `energy_readings`: Verbrauch fällt von ~6 kW in Richtung Budget-/PV-konformer Werte.
5) UI-Check: Dashboard-Heizstatus und Zieltemperaturen ändern sich sichtbar passend zur Budget-Logik.
