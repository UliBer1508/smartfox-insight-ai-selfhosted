/**
 * PWA-Registrierung mit Auto-Update.
 *
 * Verhalten:
 *  - Im Lovable-Editor-Iframe oder auf Preview-Hosts wird der SW NICHT registriert
 *    und vorhandene SWs/Caches werden gelöscht (verhindert Stale-Preview-Bugs).
 *  - In Produktion: Vite-PWA prüft regelmäßig auf neue Builds. Sobald ein neuer
 *    SW bereit ("waiting") ist, aktivieren wir ihn automatisch und reloaden die
 *    Seite – das Handy bekommt die neue Version ohne manuelles Eingreifen.
 */
export async function setupPWA() {
  if (typeof window === "undefined") return;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1";

  // Editor-/Preview-Kontext: alles abräumen, nichts registrieren
  if (isInIframe || isPreviewHost) {
    if ("serviceWorker" in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch {
        /* ignore */
      }
    }
    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (!("serviceWorker" in navigator)) return;

  // Dynamischer Import: virtual:pwa-register existiert nur, wenn vite-plugin-pwa läuft.
  try {
    const { registerSW } = await import("virtual:pwa-register");

    let reloading = false;
    const triggerReload = () => {
      if (reloading) return;
      reloading = true;
      // kurzer Delay, damit der neue SW die Kontrolle übernehmen kann
      setTimeout(() => window.location.reload(), 50);
    };

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        // Neuer Build erkannt → sofort aktivieren + reload
        console.info("[PWA] Neue Version verfügbar – wird automatisch aktiviert.");
        updateSW(true);
      },
      onOfflineReady() {
        console.info("[PWA] App bereit für Offline-Nutzung.");
      },
      onRegisteredSW(swUrl, registration) {
        if (!registration) return;

        // Throttle: max. 1 update-Check pro 60s, kein periodisches Polling.
        let lastCheck = 0;
        const safeUpdate = () => {
          const now = Date.now();
          if (now - lastCheck < 60_000) return;
          lastCheck = now;
          registration.update().catch(() => {});
        };

        // Initialer Check kurz nach Boot (frische sw.js holen)
        setTimeout(safeUpdate, 2_000);

        // Event-getriebene Checks – keine setInterval-Schleife
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") safeUpdate();
        });
        window.addEventListener("focus", safeUpdate);
        window.addEventListener("online", safeUpdate);
      },
    });


    // Wenn ein neuer SW die Kontrolle übernimmt → Reload
    navigator.serviceWorker.addEventListener("controllerchange", triggerReload);
  } catch (err) {
    console.warn("[PWA] Service-Worker-Registrierung übersprungen:", err);
  }
}
