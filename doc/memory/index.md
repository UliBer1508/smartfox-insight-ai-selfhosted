# Detail-Specs (Index)

> Verschoben aus `.lovable/memory/` am 30.09.2026 (flach abgelegt, Thema in der
> Überschrift). Master-Dokument ist `doc/SYSTEM_DOCUMENTATION.md`, Grundkonzept
> `doc/KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md`.

## arch

| Datei | Inhalt |
|---|---|
| [`ai-prompt-hardware-facts.md`](ai-prompt-hardware-facts.md) | **AI Prompt Hardware Facts Block** — Pflicht-Block in allen KI-Prompts (generate-settings-suggestions, analyze-patterns) — Smartfox steuert Batterie autonom, heating_min_battery_soc ist Untergrenze (Floor) und keine Lade-Cap |
| [`ai-system-limitations.md`](ai-system-limitations.md) | **AI/ML Integration in pv-automation** — Wie ML-Empfehlungen (learned_policies, preheating_signal) in die Heizungssteuerung einfließen |
| [`pv-automation-budget-logic-v2.md`](pv-automation-budget-logic-v2.md) | **PV-Automation Budget Logic v2** — Eco vs Komfort-Budget, Mikro-Budget, Prognose-Bonus, Batterie-Reserve, PV-Trend, gehärtetes SOC-Gate. WW wird NICHT als Budget-Reserve abgezogen (Smartfox-autonom). |
| [`pv-automation-strategy-v2.md`](pv-automation-strategy-v2.md) | **PV Automation Strategy v2 (Reactive)** — Reactive heating strategy — wait for real grid export before activating new room. No predictive "effective export" trick. |

## deployment

| Datei | Inhalt |
|---|---|
| [`tuya-local-service-implementation.md`](tuya-local-service-implementation.md) | **Tuya Local Thermostat Service v2.0** — Eigenständiger Node.js Service (`tuya-thermostat-v2/`) für lokale TGP508-Steuerung über LAN Port 6668, parallel zum collector-node |

## features/heating

| Datei | Inhalt |
|---|---|
| [`ai-shadow-decisions.md`](ai-shadow-decisions.md) | **AI Shadow Decisions System** — Schatten-Modus für KI-Parameter-Vorschläge mit Whitelist, Decision-Log, Outcome-Tracking |
| [`comfort-saturation-estrich-storage.md`](comfort-saturation-estrich-storage.md) | **Comfort Saturation Estrich Storage** — Räume wechseln nach Erreichen der Komforttemperatur zurück auf Eco-Setpoint, Estrich speichert Wärme weiter |
| [`global-temp-defaults-removed.md`](global-temp-defaults-removed.md) | **Globale Temperatur-Defaults entfernt** — Komfort-/Eco-/Nacht-Temperatur werden ausschließlich pro Raum (Einstellungen › Räume) gepflegt; globale Werte sind reine Code-Fallbacks ohne UI. |
| [`hotwater-smartfox-autonomous.md`](hotwater-smartfox-autonomous.md) | **Warmwasser autonom via Smartfox** — WW wird ausschließlich von Smartfox gesteuert. pv-automation zieht KEINE WW-Momentan-Reserve vom Heizbudget ab. |
| [`night-frost-protection-mode.md`](night-frost-protection-mode.md) | **Night Frost Protection Mode** — Nacht-Stille-Modus night_start_time–night_end_time (eingestellt 22:00–08:00) — pro Nacht EIN einziger Push beim Übergang, danach 0 Calls bis Tagesstart. Gate via system_settings.night_frost_last_pushed. |
| [`parallel-heating-allocation.md`](parallel-heating-allocation.md) | **Parallel Heating Allocation (Budget-basiert)** — Multi-Raum parallele Aktivierung — Budget = gridExport + currentlyHeatingPower + Boni. Sortierung nach Priorität 1→12. 1 Tuya-Call pro Aktivierung, kein Polling, Nachschub via 2-min Heartbeat. |
| [`parameter-usage-audit-c.md`](parameter-usage-audit-c.md) | **Parameter-Usage-Audit C** — Welche UI-Settings real wirken (PV-Hysterese, consumer_priority, Pre-Heat, Grundgebühr) nach Plan C |
| [`tagesmodus-konzept.md`](tagesmodus-konzept.md) | **Tagesmodus und Mindesttemperatur ohne PV** — Räume ohne Budget: battery_gate / wait → „Ohne PV“, grid → Eco nach Priorität bis max. Netzleistung (Konzept 27.10.2026) |
| [`soc-thresholds-consolidated.md`](soc-thresholds-consolidated.md) | **SOC-Schwellwerte konsolidiert** — Nur heating_min_battery_soc ist wirksam; min_battery_soc und target_battery_soc sind deprecated DB-Reste ohne UI/Logik |

## integration/tuya

| Datei | Inhalt |
|---|---|
| [`api-quota-management-v2.md`](api-quota-management-v2.md) | **Tuya API Quota Management v2** — Quota protection — dashboard auto-sync disabled, 60min sync gate, dynamic daily limit, push-all quota gate. |
| [`quota-reset-persistence.md`](quota-reset-persistence.md) | **Tuya Quota Auto-Reset Persistence** — Tages-/Monats-Reset des Tuya-API-Counters wird in pv-automation sofort persistiert + pg_cron Backup um 00:05/00:10 Wien. Verhindert Henne-Ei-Problem bei erschöpfter Quota. |

## security

| Datei | Inhalt |
|---|---|
| [`ki-locked-core-params.md`](ki-locked-core-params.md) | **KI darf Kernparameter nicht schreiben** — LOCKED_PARAMS-Set in ai-parameter-advisor und ai-parameter-evaluator blockiert KI-Schreibzugriffe auf Sicherheits-Schwellen |
