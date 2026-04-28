## Versionsbump auf 2.5.0

`package.json` → `"version": "2.5.0"` (von 2.4.0).

Beim nächsten Build liest `vite.config.ts` den Wert in `__APP_VERSION__`, und der Footer zeigt automatisch `v2.5.0`.

Optional: kurzer Eintrag in `.lovable/CHANGELOG.md` mit den jüngsten Änderungen (Parallele Heating-Allocation, UI-Feedback „Eco/Komfort gesetzt", 15s-Polling, Quota-Banner-Vorbereitung).