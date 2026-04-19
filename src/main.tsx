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
  // Register SW only on the real published domain
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
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
