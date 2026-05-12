---
name: AI Prompt Hardware Facts Block
description: Pflicht-Block in allen KI-Prompts (generate-settings-suggestions, analyze-patterns) — Smartfox steuert Batterie autonom, heating_min_battery_soc ist Untergrenze (Floor) und keine Lade-Cap
type: constraint
---

Alle Edge-Function-Prompts, die KI-Empfehlungen zu Heizungs-/Energie-Settings generieren, müssen einen Hardware-Fakten-Block enthalten, der zwei häufige Fehlinterpretationen verhindert:

**1. Batterie-Steuerung:** Smartfox/Fronius steuert das Laden autonom. Es existiert KEINE Software-seitige Ladeobergrenze. KI darf NIEMALS Vorschläge wie „Batterie nur bis X% laden, Rest in Heizung" machen — solche Settings gibt es nicht.

**2. `heating_min_battery_soc` (default 80%):** Ist eine **Untergrenze (Floor)** für die Heizungs-Nutzung der Batterie, KEINE Obergrenze/Cap. Nur SOC oberhalb dieses Werts darf für Komfort-Heizung verbraucht werden. Bei Wert 90% → die obersten 10% der Batterie sind für Heizung frei, 90% bleiben Reserve. Höher = mehr Reserve, niedriger = mehr Heizungs-Budget.

**Warmwasser:** Wird ebenfalls autonom von Smartfox gesteuert; keine WW-Steuer-Empfehlungen über Heizungs-Settings.

Implementiert in `generate-settings-suggestions/index.ts` (System-Prompt) und `analyze-patterns/index.ts` (User-Prompt-Header). Bei neuen KI-Prompts diesen Block ebenfalls aufnehmen.

**Why:** Ohne diesen Block hat Gemini-2.5-flash `heating_min_battery_soc` mehrfach als Lade-Cap fehlinterpretiert und unsinnige Empfehlungen abgegeben.
