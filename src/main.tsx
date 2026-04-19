import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const BUILD_ID = typeof __BUILD_TIME__ !== "undefined"
  ? __BUILD_TIME__
  : new Date().toISOString();
const BUILD_STORAGE_KEY = "fronius-smart-ai-build-id";
const APP_CACHE_PREFIXES = [
  "workbox",
  "fronius-ai",
  "app-shell-cache",
  "google-fonts-cache",
  "gstatic-fonts-cache",
  "supabase-api-cache",
];

const clearAppCaches = async () => {
  if (!("caches" in window)) return;

  const cacheKeys = await caches.keys();
  await Promise.all(
    cacheKeys
      .filter((key) => APP_CACHE_PREFIXES.some((prefix) => key.includes(prefix)))
      .map((key) => caches.delete(key))
  );
};

const persistBuildId = () => {
  try {
    localStorage.setItem(BUILD_STORAGE_KEY, BUILD_ID);
  } catch {
    // ignore storage failures
  }
};

const getStoredBuildId = () => {
  try {
    return localStorage.getItem(BUILD_STORAGE_KEY);
  } catch {
    return null;
  }
};

// Build timestamp injected at build time (used for visible version + cache busting awareness)
(window as any).__BUILD_TIME__ = BUILD_ID;

// Detect preview/iframe contexts where service workers cause stale cache problems
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const hostname = window.location.hostname;
const isPreviewHost =
  hostname.includes("id-preview--") ||
  hostname.includes("lovableproject.com") ||
  hostname === "localhost" ||
  hostname === "127.0.0.1";

const shouldRegisterSW = !isInIframe && !isPreviewHost;

if (shouldRegisterSW) {
  const previousBuildId = getStoredBuildId();
  if (previousBuildId && previousBuildId !== BUILD_ID) {
    void clearAppCaches().finally(() => {
      persistBuildId();
      window.location.reload();
    });
  } else {
    persistBuildId();
  }

  let hasReloadedOnControllerChange = false;

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hasReloadedOnControllerChange) return;
      hasReloadedOnControllerChange = true;
      window.location.reload();
    });
  }

  import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateSW(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;

        const forceUpdate = () => registration.update().catch(() => {});
        const activateWaitingWorker = () => {
          if (registration.waiting) {
            updateSW(true);
          }
        };

        forceUpdate();
        activateWaitingWorker();

        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
              updateSW(true);
            }
          });
        });

        window.addEventListener("focus", () => {
          forceUpdate();
          activateWaitingWorker();
        });

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            forceUpdate();
            activateWaitingWorker();
          }
        });

        setInterval(() => {
          forceUpdate();
          activateWaitingWorker();
        }, 60_000);
      },
    });
  });
} else {
  // Aggressively clean up any previously registered SW + caches in preview/iframe
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  }
  void clearAppCaches();
}

createRoot(document.getElementById("root")!).render(<App />);
