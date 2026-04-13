

## Plan: Batterie-Vorzeichen-Bug fixen (Smartfox-Konvention)

### Problem
Die gesamte Batterie-Logik in `pv-automation/index.ts` hat die **Vorzeichen-Konvention vertauscht**. Der Kommentar in Zeile 1018 sagt "positiv=laden, negativ=entladen", aber Smartfox meldet:
- **Negativ = Batterie lädt** (SOC steigt)
- **Positiv = Batterie entlädt** (SOC sinkt)

**Auswirkung jetzt:** Batterie lädt mit 2110W (battery_power = -2114), aber der Code denkt sie ENTLÄDT und zieht 2210W vom Budget ab. Budget sinkt von 3248W auf 1038W. Nur Bad Uli (600W) passt rein, alle anderen Räume (Zimmer Uli 1200W, Luis 1000W, Luca 1000W) werden blockiert.

### Lösung

**Datei: `supabase/functions/pv-automation/index.ts`**

1. **Zeile 1018**: Kommentar korrigieren + Vorzeichen einmal am Eingang invertieren:
```typescript
const rawBatteryPower = reading.battery_power || 0;
// Smartfox-Konvention: negativ=laden, positiv=entladen
// Normalisierung: positiv=laden, negativ=entladen (für Budget-Logik)
const batteryPower = -rawBatteryPower;
```

2. **Alle abhängigen Stellen** (Lines 1061, 1073, 1089, 1098, 1112, 1124) bleiben **unverändert** — sie sind korrekt formuliert WENN positiv=laden gilt, was durch die Invertierung jetzt stimmt.

### Auswirkung nach Fix
- Batterie lädt 2110W → `batteryPower = +2110` (positiv = laden)
- Line 1061: `batteryPower > 0 && batterySoc < 80` → SOC ist 89.5% (>80) → **keine Reserve abgezogen** ✓
- Line 1073: `batteryPower < 0` → false → **keine Entladungs-Korrektur** ✓
- Budget bleibt bei ~3248W → Bad Uli (600) + Zimmer Uli (1200) + Zimmer Luis (1000) passen alle rein

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeile 1018 (eine Zeile ändern)

