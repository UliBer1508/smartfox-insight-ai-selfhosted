import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Build timestamp injected at build time (used for visible version + cache busting awareness)
(window as any).__BUILD_TIME__ = new Date().toISOString();

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
  // Register SW only on the real published domain.
  // onNeedRefresh: a new build is available → reload immediately so users
  // never get stuck on a stale bundle (which was hiding new UI like Mikro-Budget).
  import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateSW(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (registration) {
          setInterval(() => registration.update().catch(() => {}), 60_000);
        }
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
  if ("caches" in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}

createRoot(document.getElementById("root")!).render(<App />);
