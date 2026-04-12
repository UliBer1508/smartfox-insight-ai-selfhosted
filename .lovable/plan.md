

# Fix: PV-Priority-Modus vereinfachen — nur Grid-Export zählt

## Problem
Die aktuelle PV-Priority-Bedingung (Zeile 716-717) hat zwei Blocker:
1. `!localServiceActive` verhindert Aktivierung, obwohl `controlMode === 'cloud'`
2. `batterySoc > 90` ist irrelevant — die Batterie kann nicht beeinflusst werden. Was zählt ist nur, wie viel ins Netz exportiert wird (`gridExportForPriority`)
3. `gridExportForPriority > 3000` ist zu hoch — bei 2kW+ Export lohnt es sich bereits zu heizen

## Lösung (2 Änderungen in Zeile 716-717)

### Datei: `supabase/functions/pv-automation/index.ts`

```typescript
// Vorher (Zeile 716-717):
if (quotaExhausted && controlMode === 'cloud' && !localServiceActive) {
  if (gridExportForPriority > 3000 && batterySoc > 90) {

// Nachher:
if (quotaExhausted && controlMode === 'cloud') {
  if (gridExportForPriority > 2000) {
```

**Änderungen:**
- `!localServiceActive` entfernt — blockiert fälschlich im Cloud-Modus
- `batterySoc > 90` entfernt — Batterie ist nicht steuerbar, nur der Export zählt
- Schwelle von 3000W auf **2000W** gesenkt — bei 2kW+ Export wird PV-Strom verschenkt

### Auswirkung
Bei >2kW Grid-Export wird PV-Priority aktiviert und bis zu 6 API-Calls erlaubt, um die Top-Prioritäts-Räume auf Komfort zu stellen — unabhängig von Batterie-Stand oder Quota.

