

## Befund

`APP_VERSION` in `src/lib/version.ts` liest `__APP_VERSION__`, das in `vite.config.ts` aus `process.env.npm_package_version` injiziert wird. Lovable's Build-Umgebung setzt `npm_package_version` aber **nicht zuverlässig** — auf Published kommt deshalb `"0.0.0"` (oder leer) statt der `package.json`-Version an. Deine Änderung in GitHub auf `2.4.0` in `package.json` wird also korrekt synct, aber zur Build-Zeit nicht ausgelesen.

Zusätzlich: die aktuelle Fallback-Logik in `version.ts` zeigt `2.4.0` nur, wenn `__APP_VERSION__` **gleich** `"1.0.0"` ist. Bei `"0.0.0"` greift der Fallback nicht → es wird `0.0.0` angezeigt.

## Lösung

**Single Source of Truth ohne Env-Variablen**: `package.json` direkt in `vite.config.ts` per `import` lesen und als `__APP_VERSION__` injizieren. Das funktioniert in jedem Build-Environment unabhängig davon, ob npm-Lifecycle-Variablen gesetzt sind.

### Änderungen

**1. `vite.config.ts`**
- `package.json` per `import pkg from "./package.json"` (mit `assert { type: "json" }` bzw. `with { type: "json" }`) einlesen.
- `__APP_VERSION__: JSON.stringify(pkg.version)` — kein `process.env`-Fallback mehr.

**2. `src/lib/version.ts`**
- Fallback-/Sonderlogik entfernen. Einfach: `export const APP_VERSION = __APP_VERSION__;`
- Kommentar aktualisieren: Quelle ist `package.json` zur Build-Zeit, kein Env-Var-Umweg.

**3. `package.json`**
- Sicherstellen, dass `"version": "2.4.0"` gesetzt ist (du hast es laut Aussage schon gemacht — wird verifiziert).

### Ergebnis

Nach Publish + Hard-Reload zeigt der Footer `v2.4.0`. Künftige Bumps in `package.json` (egal ob via GitHub direkt oder `npm version`) erscheinen sofort nach dem nächsten Build im Footer — keine Env-Variable nötig, kein Hardcode-Fallback.

### Hinweis

Der Build-Hash (`#xxxxxx`) im Footer bleibt der eigentliche Beweis, dass ein neuer Build live ist — die Versionsnummer ist nur das menschenlesbare Label.

