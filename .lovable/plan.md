
# Problem-Analyse und Loesung: Thermostat-Steuerung

## Identifiziertes Problem

Die Thermostat-Steuerung funktioniert nicht, weil ein **Zwischen-Glied fehlt**:

```text
PWA (Frontend)
    │
    ▼
thermostat_commands Tabelle (16 pending Befehle!)
    │
    ✖ HIER FEHLT DIE VERBINDUNG
    │
    ▼
Physische Thermostate (TGP508)
```

### Warum?

1. **useTuyaControl.setTemperature()** schreibt Befehle nur in die Datenbank
2. **pv-automation** Edge Function nutzt Tuya Cloud API, aber:
   - Macht 0 API Calls wegen Skip-Logic (Temperaturen "schon korrekt")
   - Daten sind 4 Tage alt (kein Sync seit 01.02.2026)
   - Tuya Cloud Quota war erschoepft
3. **Local Collector** (collector-node) ist nicht eingerichtet/laeuft nicht

---

## Loesungs-Optionen

### Option A: Direkte Cloud-API (Schnellste Loesung)

**Aenderung:** `useTuyaControl.setTemperature()` ruft direkt die `tuya-control/set-temp` Edge Function auf, anstatt nur in die Command-Queue zu schreiben.

**Vorteile:**
- Sofort funktionsfaehig
- Keine lokale Installation noetig

**Nachteile:**
- Verbraucht Tuya API Quota (begrenzt)
- Abhaengig von Cloud-Verfuegbarkeit

**Technische Aenderung in `src/hooks/useTuyaControl.ts`:**
```typescript
const setTemperature = async (deviceId, temperature, roomId) => {
  // VORHER: Nur Command-Queue (wird nie ausgefuehrt)
  // NACHHER: Direkt Edge Function aufrufen
  const { data, error } = await supabase.functions.invoke('tuya-control/set-temp', {
    body: { deviceId, temperature, roomId }
  });
  // ... Fehlerbehandlung + manual_override setzen
};
```

---

### Option B: Local Collector aktivieren (Langfristig besser)

**Voraussetzungen:**
1. Node.js auf lokalem PC/Raspberry Pi
2. config.json mit allen 10 Geraeten (Device IDs, Local Keys, IPs)
3. Port 6668 zu Thermostaten erreichbar

**Vorteile:**
- Keine API-Quota
- Schnellere Reaktion (20-50ms vs 200-500ms)
- Unabhaengig von Cloud

**Was fehlt:**
- Thermostat IP-Adressen (noch nicht in DB)
- config.json fuer Collector

---

## Empfohlene Vorgehensweise

**Phase 1 (Sofort):** Option A implementieren - Cloud-API direkt nutzen
**Phase 2 (Spaeter):** Local Collector einrichten wenn IPs bekannt

---

## Technische Aenderungen fuer Phase 1

### Datei: `src/hooks/useTuyaControl.ts`

**setTemperature Funktion umbauen (Zeile 86-119):**

```text
VORHER:
1. Befehl in thermostat_commands schreiben (pending)
2. manual_override setzen
3. Toast anzeigen
→ Befehl wird NIE ausgefuehrt!

NACHHER:
1. Edge Function tuya-control/set-temp aufrufen
2. Bei Erfolg: manual_override setzen
3. Toast anzeigen
4. Optional: Befehl in Command-Queue loggen (fuer Audit)
```

### Zusaetzlich: Pending Commands aufraeumen

SQL-Migration um alte pending Befehle zu loeschen:
```sql
DELETE FROM thermostat_commands WHERE status = 'pending';
```

---

## Zusammenfassung

| Komponente | Status | Aktion |
|------------|--------|--------|
| thermostat_commands Tabelle | 16 pending Befehle | Aufraeumen |
| useTuyaControl Hook | Schreibt nur in Queue | Direkt API aufrufen |
| tuya-control Edge Function | Funktioniert | Bereits vorhanden |
| pv-automation | Skip-Logic blockiert | Wird nach Sync funktionieren |
| Local Collector | Nicht eingerichtet | Spaeter (Phase 2) |
