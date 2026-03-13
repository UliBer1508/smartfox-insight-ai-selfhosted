

# KI-Einstellungsvorschläge mit Google Gemini (kostenlos)

## Bestehendes Setup

Das Projekt nutzt bereits **Google AI Studio (Gemini 2.5 Flash)** kostenlos über den `GOOGLE_AI_API_KEY`. Die `analyze-patterns` Edge Function hat bereits eine fertige `callGoogleAI()`-Abstraktionsschicht mit Tool-Calling-Support. Kein Fallback auf kostenpflichtiges Lovable AI.

## Plan

Die neue `generate-settings-suggestions` Edge Function wird die **bestehende Google AI Architektur aus `analyze-patterns`** wiederverwenden — gleiche `callGoogleAI()` Funktion, gleicher API-Key, keine Kosten.

### 1. Neue Edge Function: `generate-settings-suggestions`

- Kopiert die `callGoogleAI()` Abstraktionsschicht aus `analyze-patterns`
- Lädt Kontext selbst: `heating_settings`, `rooms`, aktuelle `smartfox_data`, `pv_forecasts`, `consumer_logs`
- Nutzt **Tool-Calling** für strukturierte Ausgabe:

```text
Tool: suggest_settings
Parameter:
  suggestions: [{
    category: "hotwater" | "night_cycling" | "global_temps" | "pv_thresholds" | "room_temp"
    setting_key: string          // z.B. "comfort_temp", "night_temp"
    room_name?: string           // nur bei room_temp
    current_value: string
    suggested_value: string  
    reason: string
    priority: "high" | "medium" | "low"
  }]
  overall_analysis: string
```

- System-Prompt erklärt die PV-Anlage, Batterie, 4-Stufen-Logik und fordert konkrete Einstellungsänderungen

### 2. Neuer Hook: `useSettingsSuggestions`

- `fetchSuggestions()` → ruft Edge Function auf
- `applySuggestion(suggestion)` → schreibt Änderung in `heating_settings` oder `rooms` Tabelle
- State: `suggestions[]`, `isLoading`, `overallAnalysis`

### 3. Neue Komponente: `AISettingsSuggestions`

- Button "KI-Vorschläge laden" mit Brain-Icon
- Vorschlagskarten mit: Was → Von/Nach, Warum, Priorität (farbcodiert)
- "Übernehmen" Button pro Vorschlag
- "Alle übernehmen" Button

### 4. Integration

- Einbindung im `HeatingDashboard` nach dem AI-Status-Widget
- `config.toml`: `verify_jwt = false` für die neue Function

### Dateien

| Datei | Aktion |
|-------|--------|
| `supabase/functions/generate-settings-suggestions/index.ts` | Neu |
| `src/hooks/useSettingsSuggestions.ts` | Neu |
| `src/components/heating/AISettingsSuggestions.tsx` | Neu |
| `src/components/heating/HeatingDashboard.tsx` | Erweitern |
| `supabase/config.toml` | Function registrieren |

