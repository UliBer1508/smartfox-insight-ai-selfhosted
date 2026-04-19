
User fragt, ob wir die Version aus GitHub (package.json) nehmen können.

Befund:
- Aktuell steht in `src/lib/version.ts` manuell `2.4.0`.
- `package.json` ist in Lovable nicht direkt editierbar, wird aber via GitHub-Sync gepflegt.
- In `vite.config.ts` wird bereits `__APP_VERSION__` aus `process.env.npm_package_version` injiziert. Bei `vite build` über npm/bun ist `npm_package_version` automatisch gesetzt → das funktioniert in Lovable-Builds.
- Fallback `'1.0.0'` greift nur, falls die Env-Variable fehlt.

Plan:
1. `src/lib/version.ts` so umbauen, dass `APP_VERSION` aus `__APP_VERSION__` (build-time aus package.json) gelesen wird, mit Fallback auf manuellen Wert.
2. `Footer.tsx` bleibt unverändert (importiert weiterhin `APP_VERSION`).
3. Damit ist die Quelle der Wahrheit `package.json` aus GitHub. Versions-Bumps geschehen dort (z.B. via `npm version patch/minor/major` lokal oder GitHub-Edit).

Hinweis an User:
- Aktuell steht in `package.json` vermutlich `0.0.0` oder Lovable-Default. Damit eine sinnvolle Version (z.B. `2.4.0`) erscheint, muss `package.json` via GitHub auf den gewünschten Wert gesetzt werden.
- Ohne GitHub-Connect bleibt der manuelle Fallback in `version.ts` aktiv.

Betroffene Dateien:
- `src/lib/version.ts` (umstellen auf `__APP_VERSION__` mit Fallback `"2.4.0"`)

Keine weiteren Änderungen nötig.

Nächste Schritte für User:
- GitHub verbinden (falls noch nicht geschehen): Connectors → GitHub → Connect project
- In `package.json` auf GitHub den `version`-Eintrag auf gewünschten Wert setzen (z.B. `"version": "2.4.0"`)
- Bei jedem Release Version dort hochzählen → Footer zeigt automatisch den neuen Wert
