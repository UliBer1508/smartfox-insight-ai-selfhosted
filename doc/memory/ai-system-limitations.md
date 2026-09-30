---
name: AI/ML Integration in pv-automation
description: Wie ML-Empfehlungen (learned_policies, preheating_signal) in die Heizungssteuerung einfließen
type: feature
---

ML-Outputs werden aktiv konsumiert, aber die deterministische Budget-Logik bleibt der finale Filter.

**Konfidenz-Gating in `pv-automation` (learned_policies):**
- `learning_confidence ≥ 0.7` + `success_rate > 0.4` → Exploitation, Policy folgen
- `0.4 ≤ learning_confidence < 0.7` → Soft-Hint, nur folgen wenn budgetkompatibel (kein activate gegen leeres Budget, kein deactivate eines komfort-gesättigten Raums)
- `learning_confidence < 0.4` → Policy ignorieren, LLM-Exploration
- `recommended_temp` wird auf `[night_temp, comfort_temp]` geclamped

**Pre-Heat-Signal:**
- `analyze-patterns` schreibt strukturiertes `system_settings.preheating_signal` (`type: preheat | store_heat | none`)
- `pv-automation` liest Signal (max 30 min alt). `preheat` hebt Eco-Budget min auf 800W; `store_heat` gibt +500W Komfort-Bonus bei pvPower>4000.
- Hard-Locks (SOC-Gate, harter PV-Gate, Manual-Override) bleiben unberührt.
- Pre-Heat-Override: Räume unter eco-0.2 werden auf activate forciert wenn SOC ok und nicht komfort-gesättigt.

**Tracking:**
- `learning_events.action.ml_recommendation = { action, temp, confidence, sample_count }` und `ml_followed: boolean` werden bei jeder Entscheidung mit Policy gespeichert.
- RPC `get_ml_follow_rate(days_back)` aggregiert Follow-Rate und Avg-Reward (gefolgt vs. überstimmt) für Dashboard-Widget `MLFollowRateWidget`.
