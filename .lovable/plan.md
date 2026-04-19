

## Befund

Root-Cause der Diskrepanz Preview↔Published ist nicht ein einzelner Bug, sondern die Kombination aus:

1. **Service Worker (vite-plugin-pwa)** mit aggressivem Caching: navigation handler `NetworkFirst` mit 3s Timeout liefert bei kleinster Latenz das **gecachte alte HTML** aus → alte JS-Bundles werden geladen → fehlende Komponenten (Footer/Settings).
2. **Komplexe Update-Kette**: `controllerchange` → reload, `localStorage` Build-ID, `setInterval(60s)` updates, `useServiceWorkerUpdate` Banner. Mehrere Reload-Trigger konkurrieren → Race Conditions, Worker bleibt aktiv.
3. **Frontend-Deploys nicht automatisch live**: Lovable benötigt explizites „Publish → Update". Bis dahin läuft auf der `.lovable.app`-Domain ein älterer Build, parallel dazu cached der bereits installierte SW dessen Bundle.
4. Der Code an sich (`Layout.tsx`, `App.tsx`, `Footer.tsx`) ist korrekt — beweisbar durch Preview-Sichtbarkeit.

User-Entscheidung: **„Immer aktuell" > Offline.**

## Lösung — PWA auf Installable-Only reduzieren (kein Service Worker)

Lovable-Doku ist explizit: für „Add to Home Screen"-Installierbarkeit braucht es **keinen** Service Worker, nur ein Manifest. Service Worker sind die alleinige Ursache aller Stale-Cache-Probleme.

### Änderungen

**1. `vite.config.ts`** — `VitePWA`-Plugin komplett entfernen. Stattdessen statisches `public/manifest.webmanifest` (bleibt installierbar). `__BUILD_TIME__` define bleibt.

**2. `public/manifest.webmanifest`** (neu) — derselbe Inhalt wie bisher generiert (Name, Icons, `display: standalone`, Shortcuts).

**3. `src/main.tsx`** — alle SW-Logik entfernen. Stattdessen einmaliger **„SW-Killer"**: jeder Client unregistert beim Start alle bestehenden SWs und löscht alle Caches. Das erlöst auch alle bereits installierten Clients beim nächsten Besuch.

```ts
// Aggressiv: alle SW killen + alle Caches leeren, immer
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
}
if ('caches' in window) {
  caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
}
```

**4. `src/hooks/useServiceWorkerUpdate.ts`** — zu No-Op (oder löschen + Header.tsx anpassen, Update-Banner entfernen).

**5. `src/components/energy/Header.tsx`** — `useServiceWorkerUpdate`-Import + Banner entfernen.

**6. `package.json`** — `vite-plugin-pwa` Dependency entfernen.

**7. Footer-Sichtbarkeits-Fix mitnehmen** — Footer läuft trotzdem rein, weil schon korrekt eingebunden. Auf Login-Seite (`/auth`) und NotFound ebenfalls aktiv via `Layout`. Verifikation per Build-Hash im Footer bleibt.

### Ergebnis

- Published `.lovable.app` lädt **immer** das frische `index.html` direkt vom Server (kein SW dazwischen).
- Bestehende Nutzer mit altem SW: beim ersten Besuch wird ihr SW unregistert + Caches geleert → ab dem **zweiten** Besuch garantiert frischer Build (oder einmaliger Hard-Reload reicht).
- App bleibt installierbar (Manifest vorhanden), aber **ohne Offline-Fallback** — bewusste Entscheidung des Users.
- „Publish → Update" bleibt notwendig für jedes Frontend-Deployment (Lovable-Plattform-Verhalten, nicht änderbar).

### Ablauf nach Implementierung

1. Code-Änderungen werden gepusht.
2. **Du** klickst „Publish → Update".
3. Auf Published einmal Hard-Reload (Strg+Shift+R) — danach läuft der neue Code, SW ist deinstalliert.
4. Alle weiteren Deploys gehen ohne Cache-Tricks live, sobald „Update" geklickt wurde.

### Was nicht geändert wird

- Datenbank, Edge Functions, Heizungs-/PV-Logik: unverändert.
- iOS-Splash-Screens, Theme-Color, Manifest-Icons: bleiben (über statisches Manifest + index.html Meta-Tags).
- Copy/Footer-Layout: bleibt wie zuletzt korrigiert.

