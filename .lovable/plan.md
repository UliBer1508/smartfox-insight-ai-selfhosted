
User fragt: Warum zeigt der Footer noch v1.0.0, obwohl das Projekt schon länger läuft und viele Features hat?

Befund:
- `Footer.tsx` liest `__APP_VERSION__`, das in `vite.config.ts` aus `process.env.npm_package_version || '1.0.0'` injiziert wird.
- In Lovable-Builds ist `npm_package_version` typischerweise nicht gesetzt → Fallback `1.0.0`.
- `package.json` darf nicht direkt editiert werden in Lovable.

Lösung: Eine eigene Versionsnummer als Konstante pflegen, unabhängig von `package.json`. Da das Projekt bereits umfangreich ist (Heizungsautomation, ML, PWA, Mikro-Budget, Dual-Control), ist eine realistische Version z.B. **2.4.0**.

Plan:
1. Neue Datei `src/lib/version.ts` mit exportierter Konstante `APP_VERSION = "2.4.0"`.
2. `Footer.tsx` nutzt `APP_VERSION` aus `version.ts` statt `__APP_VERSION__`.
3. `vite.config.ts`: `__APP_VERSION__` Injection kann bleiben (schadet nicht), wird aber im Footer nicht mehr verwendet.
4. Bei zukünftigen größeren Änderungen Version hier hochzählen (manuell durch Code-Änderung).

Optional: Frage an User welche Startversion gewünscht ist (1.0.0, 2.0.0, 2.4.0).
