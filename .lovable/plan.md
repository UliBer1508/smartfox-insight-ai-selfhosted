
Befund: Footer fehlt in Published, ist aber in Preview sichtbar. Code (`Layout.tsx`, `App.tsx`) ist korrekt — Footer ist global eingebunden. Das ist erneut das **Caching-Problem**: Published läuft mit altem Build ohne die globale Layout-Änderung.

Ursache: Frontend-Änderungen werden NICHT automatisch live geschaltet. Sie erfordern **Publish → Update**. Zusätzlich cached die PWA (Service Worker) das alte Bundle aggressiv.

Lösung — 2 Schritte für dich:

**Schritt 1: Publish → Update klicken**
- Desktop: Top-rechts Button „Publish" → „Update"
- Mobile: „..." unten rechts → „Publish" → „Update"
- Warten bis „Live" angezeigt wird

**Schritt 2: Cache auf Published leeren**
- Browser: Strg+Shift+R (Hard Reload)
- PWA (installiert): App deinstallieren, neu von `smartfox-insight-ai.lovable.app` installieren
- Alternativ: DevTools (F12) → Application → Service Workers → „Unregister" → Reload

Verifikation:
- Footer mit „© 2026 Fronius Smart AI" + Build-Hash erscheint unten auf allen Seiten (auch Login)
- Build-Hash auf Published muss mit Preview übereinstimmen

Keine Code-Änderung nötig — der Code ist bereits korrekt. Es ist ein reines Deployment-/Cache-Thema.

Falls nach Update + Hard-Reload immer noch kein Footer auf Published erscheint, dann liegt ein anderes Problem vor (z.B. Service Worker liefert komplett alten Bundle aus). In dem Fall könnte ich:
- Den Service Worker so anpassen, dass er bei jedem Update zwingend selbst entlädt und neu lädt (`skipWaiting` + `clientsClaim` + auto-reload-on-update)
- Eine sichtbare „Neue Version verfügbar — jetzt laden"-Banner einbauen

Sag Bescheid, ob nach Schritt 1+2 der Footer da ist, oder ob ich den auto-reload-Mechanismus härter machen soll.
