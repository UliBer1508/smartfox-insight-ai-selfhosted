import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { setupPWA } from "./pwa/registerSW";

const BUILD_ID = typeof __BUILD_TIME__ !== "undefined"
  ? __BUILD_TIME__
  : new Date().toISOString();

(window as any).__BUILD_TIME__ = BUILD_ID;

// PWA registrieren (in Editor/Preview wird sie übersprungen + alte SWs abgeräumt)
setupPWA();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
