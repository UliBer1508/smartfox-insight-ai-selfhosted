# Tuya-Lizenz: echte Laufzeit statt fester Text (16.11.2026)

## Problem
Beim Umschalten auf „Tuya Cloud“ stand in den Einstellungen „Die Lizenzen sind derzeit nicht verlängert“, obwohl die Lizenz am 15.11.2026 für 6 Monate erneuert wurde.

## Ursache
1. Der Text war fest im Code (`SettingsPanel.tsx`), unabhängig vom echten Status.
2. `system_settings.tuya_subscription.expires_at` stand noch auf 2026-07-16 (seit Januar nicht gepflegt).

## Prüfung bei Tuya (Protokolle 16.11.2026, 14:51–14:53)
Token-Abruf erfolgreich, Batch-Status 12/12 Geräte, 5 Sollwerte per Cloud gesetzt mit `success=true`, kein Fehlercode 28841004 → Lizenz gültig.

## Lösung
- Datenbank: `expires_at` auf **2027-05-15** gesetzt (per SQL, 16.11.2026).
- Code: Knopf „Tuya Cloud“ und Bestätigungsdialog zeigen jetzt das Ablaufdatum aus `tuya_subscription` über den vorhandenen Hook `useSubscriptionStatus` (gültig / läuft in X Tagen ab / abgelaufen). Kein neues Modul.

## Nebenwirkungen
- `useSubscriptionStatus` wird jetzt zweimal genutzt (SettingsPanel + TuyaSubscriptionAlert); der Warn-Toast erscheint trotzdem nur einmal je Sitzung (sessionStorage-Flag).
- Das Ablaufdatum lässt sich weiter in der Karte „Tuya Subscription“ (sichtbar im Cloud-Modus) ändern.

## Wartung
Nach jeder Erneuerung auf iot.tuya.com das neue Ablaufdatum in der App eintragen (nächste: ca. 15.05.2027).
