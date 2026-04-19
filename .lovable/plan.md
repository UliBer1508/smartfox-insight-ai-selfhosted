
Befund: User meldet erneut, dass Mikro-Budget in Published fehlt. Im Code (`HeatingSettingsForm.tsx` Zeilen 272-324) ist die Sektion vorhanden. Die Datenbank liefert `micro_budget_enabled: true` etc. (siehe Network-Logs). Also: Code OK, DB OK → Published-Build ist veraltet.

Kernursache: Frontend-Änderungen werden NICHT automatisch live geschaltet. Sie erfordern explizit ein **„Update" im Publish-Dialog**. Das wurde anscheinend bisher nicht (oder nicht erfolgreich) durchgeführt, oder der PWA-Service-Worker auf dem Endgerät hält die alte Version vor.

Zweiter möglicher Faktor: PWA-Service-Worker auf der published Domain (`smartfox-insight-ai.lovable.app`) cached aggressiv und zeigt veraltete Bundles trotz neuem Deploy.

Plan

1) Build-Hash sichtbar machen
- `Footer.tsx` zusätzlich zu Version + Build-Time einen kurzen **Build-Hash** anzeigen (erste 8 Zeichen des `__BUILD_TIME__`-basierten Hashes oder ms-Wert). So lässt sich nach „Update" sofort verifizieren, ob die Published-Seite den neuen Build geladen hat.

2) Service-Worker-Update erzwingen
- In `src/main.tsx` beim SW-Register zusätzlich:
  - `registerSW({ immediate: true, onNeedRefresh: () => location.reload() })` → automatischer Reload bei neuer Version, kein Stale-Cache.
- Optional: einmaliger „Hard-Refresh"-Button (versteckt in Footer) zum manuellen Cache-Reset auf Endgeräten.

3) PWA-Manifest-Versions-Bump
- `vite.config.ts`: dem Workbox-Cache einen versionierten Namen geben (z.B. `cacheId: 'fronius-ai-v2-4-0'`), damit beim nächsten Build alle alten Caches verworfen werden.

4) Anleitung an User (in der Antwort, kein Code)
- Schritt A: **Publish → Update** klicken (Pflicht für Frontend-Änderungen).
- Schritt B: Auf `smartfox-insight-ai.lovable.app` einmalig Hard-Reload (Strg+Shift+R / iOS: App schließen + erneut öffnen) ODER PWA deinstallieren und neu installieren.
- Schritt C: Footer prüfen — neuer Build-Hash muss zur Preview-Version passen.

Betroffene Dateien
- `src/components/Footer.tsx` — Build-Hash anzeigen
- `src/main.tsx` — `onNeedRefresh` Auto-Reload
- `vite.config.ts` — `cacheId` für Workbox

Keine DB-Änderungen, keine Edge-Function-Änderungen.

Erfolgskriterium
- Nach „Update" zeigt der Footer auf Published den gleichen Build-Hash wie Preview.
- Sektion „Mikro-Budget Modus" ist auf Published sichtbar.
- Künftige Frontend-Updates landen automatisch beim User (kein manueller Hard-Reload mehr nötig).
