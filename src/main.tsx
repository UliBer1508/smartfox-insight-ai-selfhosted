import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const BUILD_ID = typeof __BUILD_TIME__ !== "undefined"
  ? __BUILD_TIME__
  : new Date().toISOString();

// Expose build timestamp for the visible footer / debugging
(window as any).__BUILD_TIME__ = BUILD_ID;

// "Always fresh" strategy:
// We deliberately DO NOT register a service worker. The app stays installable
// via /manifest.webmanifest, but every page load fetches the latest index.html
// directly from the server — no stale cached HTML, no stale JS bundles.
//
// For users who previously installed an older build that DID register a SW,
// we proactively unregister it and clear all caches on every load. After one
// visit they are fully cleansed; from then on the unregister is a no-op.
if (typeof window !== "undefined") {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
  }
  if ("caches" in window) {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {});
  }
}

createRoot(document.getElementById("root")!).render(<App />);
