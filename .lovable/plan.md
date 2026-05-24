## KI-Heizplan-Duplikat im Tab „Analyse" entfernen

### Ziel
Die manuelle „KI-Heizplan"-Card im Tab **Analyse** entfernen, da der automatisch erzeugte Tagesplan bereits im Tab **Heizung** (über `AIShadowDecisions` → `AIDailyPlanCard`) angezeigt wird.

### Änderungen

**`src/pages/Index.tsx`**
- Block „📅 KI-Heizplan" (ca. Zeilen 239–308) entfernen — inkl. Button „Heizplan generieren", `HeatingPeriodCard`-Liste und Statusanzeigen.
- Ersatz: kleiner Hinweis-Block im Tab Analyse:  
  „Der automatische KI-Heizplan wird im Tab **Heizung** angezeigt." mit Button → `setActiveTab('heating')`.
- Ungenutzte Imports entfernen: `useHeatingAI`-Destructuring (`isHeatingAnalyzing`, `analysisResult`, `handleAnalyze`), `HeatingPeriodCard`, ggf. `Thermometer`, `Sun`, `Battery`.

### Nicht geändert
- `AIDailyPlanCard.tsx`, `AIShadowDecisions.tsx`, `HeatingDashboard.tsx`
- Edge Function `ai-daily-planner` + Cron
- Datenbankschema
- `useHeatingAI`-Hook bleibt (Cleanup später möglich)

### Verifikation
- Tab Analyse: kein doppelter Heizplan mehr, nur Hinweis + Navigationsbutton.
- Tab Heizung: automatischer Tagesplan unverändert sichtbar.
