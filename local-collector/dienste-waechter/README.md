# Dienste-Wächter

Kleiner Windows-Dienst für den **Systemstatus** in der Heizungs-App (Symbol oben rechts).
Läuft auf **jedem PC** (Österreich und München) als eigener NSSM-Dienst `DiensteWaechter`.
Ausführliche Beschreibung: `doc/SYSTEMSTATUS-2026-11-05.md`.

## Was er tut

Alle 30 Sekunden:

1. findet alle NSSM-Dienste des PCs automatisch (wie das Dienste-Fenster im Wallbox-Backend) plus die
   Zusatzdienste aus `config.json` (Tailscale),
2. meldet ihren Zustand an Supabase (Edge Function `system-agent`),
3. führt Start/Stop/Neustart aus, die in der App angeklickt wurden.

Die Verbindung geht **vom PC nach außen** (HTTPS). Tailscale und Cloudflare werden dafür nicht gebraucht –
läuft Tailscale nicht, kann man es trotzdem aus der App starten.

## Regeln

| Dienst | In der App |
|---|---|
| NSSM-Dienste (SmartfoxTuya, SmartfoxFronius, Wallbox-Backend, alexa-bridge …) | Start, Stop, Neustart |
| Fernzugriff (Tailscale, Cloudflare-Tunnel) | nur Start – nie aus der Ferne abschalten |
| Der Wächter selbst | nur ansehen (stürzt er ab, startet NSSM ihn neu) |

Dieselben Regeln prüft auch die Datenbank (SQL 22) – doppelt hält besser.

## Einrichten (einmal je PC)

Voraussetzung: Node.js 18 oder neuer, NSSM (beides ist auf beiden PCs schon da).

1. Ordner `local-collector\dienste-waechter` auf den PC kopieren, z. B. nach `C:\Users\ulibe\dienste-waechter`
   (Österreich: nach `git pull` liegt er schon in `C:\Heizung\repo\local-collector\dienste-waechter`).
2. Vorlage kopieren: Österreich `config.oesterreich.example.json`, München `config.muenchen.example.json`
   → `config.json`, und bei `token` das Token eintragen (gleich wie das Supabase-Secret `SYSTEM_AGENT_TOKEN`).
3. `install-dienst.bat` per Rechtsklick **als Administrator** ausführen.
   Es testet zuerst (Dienste finden, Cloud erreichen) und richtet dann den Dienst ein.

Nach etwa 30 Sekunden erscheint der PC in der App.

## Prüfen

```powershell
nssm status DiensteWaechter
Get-Content .\logs\waechter.log -Tail 20
node index.js --test      # zeigt die gefundenen Dienste, prüft Adresse und Token, ändert nichts
```

## Anpassen

- Schönere Namen und Links: in `config.json` unter `services` (Schlüssel = echter Dienstname).
- Dienst ausblenden: `"hidden": true`.
- Nur ansehen statt steuern: `"control": "none"`.
- Weitere Nicht-NSSM-Dienste: unter `extraServices` (immer nur Start).

Nach einer Änderung: `nssm restart DiensteWaechter`.
