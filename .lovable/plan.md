
Ziel: Die Published-Version soll denselben Stand wie der aktuelle Code zeigen, inklusive „Mikro-Budget Modus“ in den Einstellungen.

Befund
- Die Mikro-Budget-Felder sind im aktuellen Code bereits vorhanden:
  - `src/components/heating/HeatingSettingsForm.tsx` Zeilen 272–324
- Deine Screenshots der Published-Version zeigen genau diese Sektion nicht.
- Damit ist das Problem sehr wahrscheinlich kein Formular-/DB-Fehler, sondern ein veraltetes Frontend-Bundle in der Published-Version.
- Die aktuelle PWA-/Service-Worker-Konfiguration ist widersprüchlich:
  - `src/main.tsx` registriert den Service Worker immer sofort
  - `vite.config.ts` nutzt aggressive Auto-Update-Einstellungen (`autoUpdate`, `skipWaiting`, `clientsClaim`)
  - `src/hooks/useServiceWorkerUpdate.ts` wartet aber auf einen „waiting worker“, um den Update-Button zu zeigen
- Ergebnis: alte Published-Caches bleiben hängen, und der Update-Button kann in diesem Setup gar nicht zuverlässig erscheinen.

Umsetzungsplan
1. Service-Worker-Strategie vereinheitlichen
- Eine klare Update-Strategie für Published einführen, damit neue Frontend-Builds zuverlässig erkannt werden.
- Die Konfiguration in `vite.config.ts` und `src/hooks/useServiceWorkerUpdate.ts` auf dasselbe Verhalten ausrichten.
- Den Update-Banner so umbauen, dass er mit der gewählten Strategie wirklich ausgelöst werden kann.

2. Service Worker in Preview/Editor konsequent blockieren
- In `src/main.tsx` die Registrierung nur noch in echter Published-Umgebung zulassen.
- In Preview-/Iframe-Kontexten vorhandene Service Worker aktiv deregistrieren, damit keine alten Caches weiterwirken.
- So wird verhindert, dass Preview und Published sich gegenseitig mit alten Assets „vergiften“.

3. Published-Version gegen stale cache härten
- Die PWA-Config so anpassen, dass neue App-Versionen sauber erkannt werden, ohne dass alte Shell-Dateien ewig weiterverwendet werden.
- Falls nötig den Update-Banner in `src/components/energy/Header.tsx` sichtbarer/robuster machen, damit Nutzer die Aktualisierung tatsächlich auslösen können.

4. Sichtbare Build-Erkennung ergänzen
- Optional eine kleine sichtbare Versions-/Build-Anzeige im Header oder Footer ergänzen.
- Damit ist sofort erkennbar, ob Published wirklich auf dem neuesten Frontend-Build läuft.

5. Dokumentation aktualisieren
- `.lovable/SYSTEM_DOCUMENTATION.md` um die finale PWA-/Update-Strategie ergänzen.
- `.lovable/CHANGELOG.md` mit dem Fix für Published/PWA-Update-Verhalten aktualisieren.

Technische Details
- Betroffene Dateien:
  - `src/components/heating/HeatingSettingsForm.tsx`
  - `src/main.tsx`
  - `src/hooks/useServiceWorkerUpdate.ts`
  - `src/components/energy/Header.tsx`
  - `vite.config.ts`
  - `.lovable/SYSTEM_DOCUMENTATION.md`
  - `.lovable/CHANGELOG.md`
- Keine Datenbank- oder RLS-Änderung nötig.
- Fokus ist rein auf Frontend-Deployment, Cache und PWA-Update-Mechanik.

Erfolgskriterien
- In Published ist die Sektion „Mikro-Budget Modus“ sichtbar.
- Preview zeigt keine veralteten PWA-Artefakte mehr.
- Der Update-Hinweis erscheint konsistent, falls eine neue Published-Version verfügbar ist.
- Ein erneutes Publish/Update reicht danach aus, damit neue UI-Felder zuverlässig live gehen.
