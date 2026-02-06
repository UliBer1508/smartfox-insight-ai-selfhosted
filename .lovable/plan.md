
# Plan: Implementierung der ML-Entscheidungs-Persistierung

## Analyse der aktuellen Situation

### Problem
Die ML-Entscheidungen aus `analyze-patterns` (mit `type: 'optimize_decision'`) werden in der `pv-automation` Edge Function generiert, verwendet zur Steuerung der Thermostate, aber **niemals in die Datenbank gespeichert**. Das führt dazu, dass:
- Die Frontend-Hooks `useHeatingAnalysis` und `useRooms` leere Tabellen sehen (`heating_recommendations` und `room_recommendations`)
- Es keine historischen Daten für das Logging gibt
- Die UI keine ML-Entscheidungen anzeigen kann

### Workflow-Analyse
1. **pv-automation/index.ts Zeile ~510-530**: Fetch `analyze-patterns` mit `type: 'optimize_decision'`
2. **analyze-patterns/index.ts Zeile ~278**: Bearbeitet `optimize_decision` mit Google AI und Tool-Calling
3. **Response**: Gibt `MLDecisionResponse` mit `decisions[]` und `overall_strategy` zurück
4. **pv-automation Zeile ~530**: Speichert in `mlDecisions = mlResult.decisions` ✓
5. **pv-automation Zeile ~626-684**: Verwendet `mlDecision` für Tuya-Steuerung ✓
6. **MISSING**: Keine Persistierung in Datenbank ✗

### Datenstruktur aus useHeatingAnalysis.ts (Zeilen 63-78)
Das Frontend speichert bereits erfolgreich nach dem `analyze-patterns` Call:
- `heating_recommendations` (für generelle Perioden)
- `room_recommendations` (für raumspezifische Empfehlungen)

Wir müssen das gleiche in der `pv-automation` Edge Function implementieren.

---

## Implementierungsplan

### Schritt 1: Datenstruktur der ML-Entscheidungen verstehen
In `analyze-patterns/index.ts` müssen wir prüfen, welche Struktur `MLDecisionResponse` und `MLDecision` haben:
- Jedes Element sollte enthalten: `room_id`, `recommended_temp`, `reason`, `priority` oder `action`
- Diese Struktur muss mit den Tabellenspalten von `room_recommendations` matchen

### Schritt 2: Persistierungs-Logik in pv-automation hinzufügen
Nach Zeile 530 in `supabase/functions/pv-automation/index.ts` (direkt nach `mlDecisions = mlResult.decisions`):

**Neue Logik:**
```typescript
// Persistiere ML-Entscheidungen in room_recommendations
if (mlDecisions && mlDecisions.length > 0) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD lokale Zeit
  const now = new Date();
  
  // Bestimme aktuelle Tagesperiode (8 Perioden à 3 Stunden)
  const hour = now.getHours();
  const periodNumber = Math.floor(hour / 3);
  const startHour = periodNumber * 3;
  const endHour = (periodNumber + 1) * 3;
  
  const startTime = `${String(startHour).padStart(2, '0')}:00`;
  const endTime = `${String(endHour).padStart(2, '0')}:00`;
  
  // Für jede ML-Entscheidung: INSERT in room_recommendations
  for (const decision of mlDecisions) {
    const roomId = decision.room_id;
    const recommendedTemp = decision.recommended_temp || settings?.eco_temp || 19;
    const reason = decision.reason || `ML Decision: ${decision.action}`;
    const priority = decision.action || 'hold'; // heat_now, preheat, hold, reduce, off
    
    // UPSERT: Falls gleicher Raum/Datum/Zeit bereits existiert, aktualisieren
    await supabaseClient
      .from('room_recommendations')
      .upsert({
        room_id: roomId,
        date: today,
        period_number: periodNumber,
        start_time: startTime,
        end_time: endTime,
        recommended_temp: recommendedTemp,
        reason: reason,
        priority: priority,
      }, {
        onConflict: 'room_id,date,period_number'
      });
  }
  
  console.log(`[PV-Automation] Persistiert ${mlDecisions.length} ML-Entscheidungen in DB`);
}
```

### Schritt 3: Persistierung für heating_recommendations (Basis-Plan)
Optional: Auch eine Zusammenfassung in `heating_recommendations` speichern (ähnlich wie im Frontend), wenn es sich um eine tägliche Analyse handelt.

### Schritt 4: Test & Verifizierung
Nach der Implementierung:
1. Prüfe: `SELECT * FROM room_recommendations WHERE date = CURRENT_DATE;` - sollte jetzt Einträge haben
2. Prüfe Frontend: `useRooms().recommendations` sollte nicht leer sein
3. Prüfe pv-automation Logs: Sollte melden `Persistiert X ML-Entscheidungen in DB`

---

## Kritische Punkte

### Zeit-Handling
- **Problem**: Verschiedene Zeitzonen (Edge Function läuft in UTC, User in Europa/Wien)
- **Lösung**: Verwende `getLocalDateString()` aus `src/lib/dateUtils.ts` auch in Edge Functions
- **Alternativ**: In der Response von analyze-patterns schon die lokale Zeit übergeben

### onConflict-Strategie
- Nutze `onConflict: 'room_id,date,period_number'` um Duplikate zu vermeiden
- Bei mehrfach-Aufrufen an `pv-automation` pro Stunde wird derselbe Eintrag aktualisiert

### Lovable AI Integration
- Die ML-Entscheidungen kommen von Google Gemini (`gemini-2.5-flash`) ✓ bereits gefixt
- Keine zusätzlichen API-Keys nötig

---

## Dateien, die geändert werden

| Datei | Änderung | Art |
|-------|----------|-----|
| `supabase/functions/pv-automation/index.ts` | Nach Zeile 530: Persistierungs-Logik einfügen | INSERT/UPSERT |
| `.lovable/plan.md` | Update Status auf IMPLEMENTED | Dokumentation |

