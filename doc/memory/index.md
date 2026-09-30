# Detail-Specs (Index)

> Verschoben aus `.lovable/memory/` am 30.09.2026. Jede Datei beschreibt eine
> Regel oder Entscheidung im Detail; das Master-Dokument ist `doc/SYSTEM_DOCUMENTATION.md`.

## arch

| Datei | Inhalt |
|---|---|
| [`arch/ai-prompt-hardware-facts.md`](arch/ai-prompt-hardware-facts.md) | **AI Prompt Hardware Facts Block** — Pflicht-Block in allen KI-Prompts (generate-settings-suggestions, analyze-patterns) — Smartfox steuert Batterie autonom, heating_min_battery_soc ist Untergrenze (Floor) und keine Lade-Cap |
| [`arch/ai-system-limitations.md`](arch/ai-system-limitations.md) | **AI/ML Integration in pv-automation** — Wie ML-Empfehlungen (learned_policies, preheating_signal) in die Heizungssteuerung einfließen |
| [`arch/pv-automation-budget-logic-v2.md`](arch/pv-automation-budget-logic-v2.md) | **PV-Automation Budget Logic v2** — Eco vs Komfort-Budget, Mikro-Budget, Prognose-Bonus, Batterie-Reserve, PV-Trend, gehärtetes SOC-Gate. WW wird NICHT als Budget-Reserve abgezogen (Smartfox-autonom). |
| [`arch/pv-automation-strategy-v2.md`](arch/pv-automation-strategy-v2.md) | **PV Automation Strategy v2 (Reactive)** — Reactive heating strategy — wait for real grid export before activating new room. No predictive "effective export" trick. |

## deployment

| Datei | Inhalt |
|---|---|
| [`deployment/tuya-local-service-implementation.md`](deployment/tuya-local-service-implementation.md) | **Tuya Local Thermostat Service v2.0** — Eigenständiger Node.js Service (`tuya-thermostat-v2/`) für lokale TGP508-Steuerung über LAN Port 6668, parallel zum collector-node |

## features/heating

| Datei | Inhalt |
|---|---|
| [`features/heating/ai-shadow-decisions.md`](features/heating/ai-shadow-decisions.md) | **AI Shadow Decisions System** — Schatten-Modus für KI-Parameter-Vorschläge mit Whitelist, Decision-Log, Outcome-Tracking |
| [`features/heating/comfort-saturation-estrich-storage.md`](features/heating/comfort-saturation-estrich-storage.md) | **Comfort Saturation Estrich Storage** — Räume wechseln nach Erreichen der Komforttemperatur zurück auf Eco-Setpoint, Estrich speichert Wärme weiter |
| [`features/heating/global-temp-defaults-removed.md`](features/heating/global-temp-defaults-removed.md) | **Globale Temperatur-Defaults entfernt** — Komfort-/Eco-/Nacht-Temperatur werden ausschließlich pro Raum im RoomManager gepflegt; globale Werte sind reine Code-Fallbacks ohne UI. |
| [`features/heating/hotwater-smartfox-autonomous.md`](features/heating/hotwater-smartfox-autonomous.md) | **Warmwasser autonom via Smartfox** — WW wird ausschließlich von Smartfox gesteuert. pv-automation zieht KEINE WW-Momentan-Reserve vom Heizbudget ab. |
| [`features/heating/night-frost-protection-mode.md`](features/heating/night-frost-protection-mode.md) | **Night Frost Protection Mode** — Nacht-Stille-Modus 20:00-08:00 — pro Nacht EIN einziger Tuya-Push beim Übergang, danach 0 Calls bis Eco-Start. Gate via system_settings.night_frost_last_pushed. |
| [`features/heating/parallel-heating-allocation.md`](features/heating/parallel-heating-allocation.md) | **Parallel Heating Allocation (Budget-basiert)** — Multi-Raum parallele Aktivierung — Budget = gridExport + currentlyHeatingPower + Boni. Sortierung nach Priorität 1→12. 1 Tuya-Call pro Aktivierung, kein Polling, Nachschub via 2-min Heartbeat. |
| [`features/heating/parameter-usage-audit-c.md`](features/heating/parameter-usage-audit-c.md) | **Parameter-Usage-Audit C** — Welche UI-Settings real wirken (PV-Hysterese, consumer_priority, Pre-Heat, Grundgebühr) nach Plan C |
| [`features/heating/soc-thresholds-consolidated.md`](features/heating/soc-thresholds-consolidated.md) | **SOC-Schwellwerte konsolidiert** — Nur heating_min_battery_soc ist wirksam; min_battery_soc und target_battery_soc sind deprecated DB-Reste ohne UI/Logik |

## integration/tuya

| Datei | Inhalt |
|---|---|
| [`integration/tuya/api-quota-management-v2.md`](integration/tuya/api-quota-management-v2.md) | **Tuya API Quota Management v2** — Quota protection — dashboard auto-sync disabled, 60min sync gate, dynamic daily limit, push-all quota gate. |
| [`integration/tuya/quota-reset-persistence.md`](integration/tuya/quota-reset-persistence.md) | **Tuya Quota Auto-Reset Persistence** — Tages-/Monats-Reset des Tuya-API-Counters wird in pv-automation sofort persistiert + pg_cron Backup um 00:05/00:10 Wien. Verhindert Henne-Ei-Problem bei erschöpfter Quota. |

## security

| Datei | Inhalt |
|---|---|
| [`security/ki-locked-core-params.md`](security/ki-locked-core-params.md) | **KI darf Kernparameter nicht schreiben** — LOCKED_PARAMS-Set in ai-parameter-advisor und ai-parameter-evaluator blockiert KI-Schreibzugriffe auf Sicherheits-Schwellen |
