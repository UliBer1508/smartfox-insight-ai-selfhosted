

## Plan: Eco-Übergang darf Quota nicht blockieren

### Problem
Die Tages-Quota (dynamisch berechnet: 24 Calls) ist um 9:00 bereits erschöpft, weil die Nacht-Befehle (12 Räume auf Frostschutz setzen) die Quota aufgebraucht haben. Der SOFORT-RETURN (Zeile 734) blockiert dann die **gesamte Heizlogik** — die Thermostate bleiben auf Nachtmodus obwohl es 9:45 ist.

### Rechnung
- 900 monatlich - 454 verbraucht = 446 Rest / 18 Tage = **24/Tag dynamisch**
- Minus 2 Reserve = **22 effektiv**
- Nacht: 12 Räume × 1 Call = 12 Calls (Frostschutz setzen)
- Sync: 2 Calls (Pre-Sync)
- → 14 Calls schon verbraucht vor 9:00, aber der Counter zeigt 24 (inkl. vorheriger Heartbeats)
- → Um 9:00 ist kein Budget mehr für die Eco-Umschaltung

### Lösung: Kritische Eco-Transition von Quota ausnehmen

**Änderung in `supabase/functions/pv-automation/index.ts` (Zeile 723-745)**

Statt SOFORT-RETURN bei erschöpfter Quota, prüfen ob Räume noch auf Nacht-Temperatur stehen und es nach 9:00 ist. In diesem Fall: Eco-Transition als **kritisch** markieren und trotzdem durchlassen.

```typescript
if (quotaExhausted && controlMode === 'cloud') {
  // Prüfe ob kritische Eco-Transition nötig ist (Räume noch auf Nacht-Temp nach 9:00)
  const needsCriticalEcoTransition = currentWienHour >= 9 && allRooms.some(r => {
    const currentTarget = Number(r.target_temp) || 0;
    const ecoTemp = r.eco_temp || 19;
    return r.tuya_device_id && r.automation_enabled && currentTarget < ecoTemp - 1;
  });
  
  if (needsCriticalEcoTransition) {
    // Eco-Übergang ist Pflicht — Quota-Limit für diese kritische Transition ignorieren
    console.log(`[PV-Automation] 🔥 KRITISCHE ECO-TRANSITION: ${currentWienHour}:xx, Räume noch auf Nacht → Quota-Override für Eco`);
    quotaExhausted = false; // Temporär freigeben
  } else {
    // Normale PV-Priority-Logik...
    const pvPriorityActive = ...;
    if (pvPriorityActive) { ... }
    else { SOFORT-RETURN }
  }
}
```

**Zusätzlich: Dynamisches Tages-Limit erhöhen**

Das Problem ist auch, dass 24 Calls/Tag für 12 Räume × 2 Übergänge (Nacht→Eco, Eco→Nacht) = 24 zu knapp ist. Lösung:

- `configuredDailyLimit` von 33 auf **40** erhöhen (in der DB, `system_settings` → `tuya_api_quota`)
- Oder: das dynamische Limit als Minimum 30 setzen: `Math.max(30, dynamicDailyLimit)`

### Betroffene Datei
- `supabase/functions/pv-automation/index.ts` — Zeilen 723-745 (SOFORT-RETURN Logik)

