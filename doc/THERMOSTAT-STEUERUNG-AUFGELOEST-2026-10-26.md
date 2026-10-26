# Thermostat-Steuerung aufgelöst – jede Funktion hat jetzt genau einen Platz

**Datum:** 26. Oktober 2026
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted`
**Supabase:** `pflnniklvqbwjwrjswaz`
**Betroffen:** nur Frontend (Vercel). Keine Edge Function, keine Datenbank, kein Cron-Job geändert –
kein `supabase functions deploy` nötig.

**Zusammenfassung:** Seit dem Umbau vom 23.10. gab es drei Stellen mit Raumkarten: die Übersicht,
Einstellungen › Räume und die alte Karte „Thermostat-Steuerung“ im Tab *Heizung & KI*. Die alte
Karte wurde aufgelöst; jede ihrer Funktionen ist an einen eindeutigen Platz umgezogen. Beide
Steuerwege (lokaler Dienst und Tuya Cloud) bleiben vollständig erhalten. Dabei wurden zwei echte
Fehler gefunden: ein irreführend beschrifteter Hauptschalter und ein falscher Zeitstempel, der
Offline-Fehler verdecken konnte.

---

## 1. Wo was jetzt liegt

| Aufgabe | Ort | Lokal-Modus | Cloud-Modus |
|---|---|---|---|
| Ansehen: Ist, Soll, heizt, Messzeit, Modus | **Übersicht** | DB (vom Dienst gefüllt) | DB (von `sync-all` gefüllt) |
| Kurz übersteuern (1–24 h) und beenden | **Übersicht** | `thermostat_commands` | `tuya-control/set-temp` (Kontingent) |
| Hinweise „Estrich-Speicher“, „Solar bis …“ | **Übersicht** (neu) | – | – |
| Grundwerte Nacht/Eco/Komfort, PV-Automatik | **Einstellungen › Räume** | – | – |
| **Automatik** je Raum (`automation_enabled`) | **Einstellungen › Räume** (neu) | – | – |
| Alle Sollwerte erneut senden | **Einstellungen › Betrieb** (neu) | `thermostat_commands` je Raum | `tuya-control/push-all-temps` (Kontingent, Rest übersprungen) |
| Werte aus der Tuya Cloud lesen | **Einstellungen › Betrieb** (neu, nur Cloud sichtbar) | – (Dienst liest selbst) | `tuya-control/sync-all?force=1` |
| Steuerungsmodus Lokal/Cloud | Einstellungen › Betrieb | – | – |
| Cloud-Verbindungstest, Region | Einstellungen › Tuya Cloud | – | `tuya-control/test`, `/set-region` |
| Abo-Warnung | Einstellungen › Tuya Cloud | – | nur im Cloud-Modus |
| Fehlerbanner „Erneut versuchen“ | Heizung & KI | stößt `pv-automation` an, lädt DB | zusätzlich `sync-all` (60-Min-Sperre) |
| Raum-Priorität | Heizung & KI › Raum-Übersicht | – | – |

Unverändert und weiter vorhanden: Edge Function `tuya-control` mit allen Pfaden (`/devices`,
`/status`, `/set-temp`, `/sync-all`, `/push-all-temps`, `/set-mode-all`, `/switch`, `/test`,
`/set-region`, `/device-spec`), alle Cloud-Zweige in `pv-automation` (Kontingent, Pre-Sync alle 6 h,
STOP-Reserve, PV-Priority) und `useTuyaControl` inklusive der derzeit ungenutzten Cloud-Helfer
`fetchDevices`/`getStatus`.

## 2. „Auto-Empfehlung (KI)“ war in Wahrheit der Hauptschalter ⭐

Die alte Karte beschriftete `rooms.automation_enabled` als „Auto-Empfehlung (KI)“. Tatsächlich lädt
`pv-automation` **nur Räume mit `automation_enabled = true`**:

```ts
.from('rooms').select('*').eq('automation_enabled', true).not('tuya_device_id', 'is', null)
```

Aus bedeutet also: Der Raum bekommt **überhaupt keine Befehle** mehr – auch nicht den Nacht- oder
Frostschutz-Befehl am Abend. Der Code-Kommentar in `pv-automation` („controls ONLY ML
recommendations“) ist falsch; er bezieht sich nur auf einen späteren Zweig innerhalb der
Schleife, die Räume mit `false` gar nicht mehr erreichen. Die Übersicht zeigte den Zustand schon
richtig als „Automatik aus“.

In Einstellungen › Räume fehlte der Schalter. Neu:
- Schalter **„Automatik“** über der PV-Überschuss-Automatik, gespeichert mit dem Speichern-Knopf
  der Karte (nur geänderte Felder, Konfliktprüfung wie bei allen Feldern).
- Steht er auf aus: Warnhinweis auf der Karte und Badge „Automatik aus“ im Kopf.
- Neue Räume werden mit `automation_enabled = true` angelegt (DB-Standard ist `false` – ein neuer
  Raum wäre sonst nie gesteuert worden).

Zum Prüfen, ob noch ein Raum still ausgeschaltet ist (z. B. Haustür, per Migration vom 30.04.
auf `false` gesetzt wegen der damaligen Cloud-Sperre):
```sql
select name, automation_enabled, pv_auto_enabled, heating_paused_reason
from rooms order by priority;
```

## 3. Falscher Zeitstempel bei „Alle pushen“ (Lokal-Modus) ⭐

`usePushAllTemps` setzte nach dem Einreihen der Befehle sofort `rooms.last_thermostat_sync = now`
für alle Räume – bevor irgendein Thermostat geantwortet hatte. Folgen:
- „Zuletzt …“ in der Oberfläche zeigte eine Lesung, die es nicht gab.
- `auto-resolve-api-errors` wertet ein frisches `last_thermostat_sync` als „Gerät erreichbar“
  (Fix vom 16.09.) und hätte offene `device_offline`-Fehler fälschlich geschlossen.

**Fix:** Im Lokal-Zweig wird `last_thermostat_sync` nicht mehr geschrieben. Das Feld setzt nur
noch der lokale Dienst nach einer echten Lesung. Im Cloud-Zweig setzt es die Edge Function nach
einem erfolgreichen Tuya-Aufruf – das ist korrekt und bleibt.

## 4. „Sync“ im Lokal-Modus war wirkungslos

`syncAllStatus` lädt im Lokal-Modus nur die Datenbank neu (kein Gerätekontakt), die Seite tut das
ohnehin alle 60 s. Im Cloud-Modus dagegen ist `sync-all` der einzige Weg zu Ist-Werten, wenn der
PC in Österreich aus ist. Deshalb:
- Knopf **„Werte aus der Tuya Cloud lesen“** nur im Cloud-Modus, mit `force=1` (umgeht nur die
  60-Minuten-Sperre, nie die Kontingent-Prüfung).
- `syncAllStatus({ force, silent })` meldet jetzt ehrlich, ob wirklich gelesen wurde, ob die
  60-Min-Sperre griff (`gated`) oder das Kontingent erschöpft war.

## 5. Warum ein Sende-Knopf pro Raum nicht nötig ist

Der lokale Dienst schreibt bei jeder Lesung den **tatsächlichen** Sollwert des Thermostats in
`rooms.target_temp`. Weicht er von dem ab, was `pv-automation` haben will, sendet `pv-automation`
beim nächsten Lauf neu (`tempAlreadyCorrect`-Prüfung). Im Cloud-Modus erzwingt `pv-automation`
nach > 60 min ohne Lesung einen Push (`syncStale`). „Alle Sollwerte erneut senden“ bleibt als
Notfallknopf (Stromausfall, Thermostat-Neustart).

## 6. Entfernt

| Datei | Grund |
|---|---|
| `src/components/heating/ThermostatCard.tsx` | Funktionen umgezogen (Tabelle oben) |
| `src/components/heating/StatusLegend.tsx` | nur von der Thermostat-Karte benutzt |
| `src/hooks/useAutomation.ts` | Schalter speichert jetzt über `useRooms.updateRoomFields` |
| `src/components/heating/RoomManager.tsx` | seit 23.10. ungenutzt |
| `src/components/heating/HeatingSettingsForm.tsx` | seit 23.10. ungenutzt |
| `RoomStatusTable`: `handleSyncNow`, `formatSyncAge` | toter Code |

Die Anzeige „Zyklen heute“ der alten Karte wurde **nicht** übernommen: Die Heizzyklen
(`heating_start`/`heating_stop`) schreibt nur der lokale Dienst, und diese Schreibvorgänge scheitern
an RLS (offen seit 30.09., siehe unten). Die Anzeige war bei allen Räumen leer.

## 7. Geänderte und neue Dateien

- `src/components/settings/ThermostatMaintenance.tsx` – **neu**: Alle senden + Cloud lesen
- `src/components/energy/SettingsPanel.tsx` – Wartung im Abschnitt Betrieb
- `src/components/settings/RoomsSection.tsx` – Automatik-Schalter, Warnung, Badge, neuer Raum mit Automatik an
- `src/components/overview/HouseOverview.tsx` – Hinweise Estrich-Speicher und Solar-Limit
- `src/components/heating/HeatingDashboard.tsx` – Thermostat-Steuerung entfernt, Fehlerbanner-Retry lädt Räume neu
- `src/components/heating/RoomStatusTable.tsx` – toter Code entfernt
- `src/hooks/usePushAllTemps.ts` – kein falscher Zeitstempel mehr
- `src/hooks/useTuyaControl.ts` – `syncAllStatus({ force, silent })`, ehrliche Meldungen

Geprüft: `vite build` erfolgreich; `tsc` zeigt nur die 5 bekannten Altfehler (AIShadowDecisions,
usePvAccuracy, useRooms), keine neuen.

## 8. Offen (nächste Schritte)

1. **RLS für `room_heating_logs`** – der lokale Dienst (anon) darf nicht einfügen, Heizzyklen
   fehlen dem Lernsystem und der Anzeige. Vorschlag aus 30.09.: Trigger analog
   `trg_capture_room_temperature_sample`.
2. **Gleicher Zeitstempel-Fehler in `pv-automation`** – nach einem erfolgreichen Setzen werden
   `last_thermostat_sync = now` geschrieben und offene `api_errors` des Raums geschlossen. Im
   Lokal-Modus heißt „erfolgreich“ aber nur „eingereiht“. Backend-Änderung, separat prüfen.
3. Code-Kommentar zu `automation_enabled` in `pv-automation` korrigieren (nur Kommentar).
