import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

// Auto-update SW: serves new version on next navigation
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(<App />);
