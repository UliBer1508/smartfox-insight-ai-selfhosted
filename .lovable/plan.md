
## Code-Review: Vorgeschlagener TuyAPI-Controller

### Was der neue Code richtig macht ✅

| Punkt | Status | Bewertung |
|---|---|---|
| Per-Device-Queue (`enqueue`) | ✅ Implementiert | Löst das Parallelitäts-Problem (Hauptursache für hängende Promises) |
| Connect-Timeout (5s) | ✅ Neu | Verhindert ewig hängende `connect()`-Aufrufe — **starke Verbesserung** |
| `safeDisconnect` im Fehlerpfad | ✅ Implementiert | Löst Connection-Leak im aktuellen Code |
| Persistenter Device-Pool | ✅ Beibehalten | War schon im aktuellen Code OK |
| `issueGetOnConnect: false` | ✅ Neu | Reduziert unnötigen Traffic beim Connect |

### Was der neue Code FALSCH/SCHLECHTER macht ❌

**1. KRITISCH: DPS-Mapping ist falsch**

Aktueller Code (korrekt laut `mem://integration/tuya-tgp508-dps-mapping`):
```js
const DPS = { MODE: '1', TARGET_TEMP: '2', CURRENT_TEMP: '3', HEATING: '4' };
```

Neuer Code:
```js
current_temp: status.dps['1']  // ❌ Das ist MODE, nicht current_temp
target_temp: status.dps['2']   // ✅ ok
is_heating: status.dps['4']    // ✅ ok
// CURRENT_TEMP ('3') fehlt komplett!
```

**Folge:** `current_temp` würde den Mode-String zurückgeben statt der echten Temperatur. Frontend zeigt Müll.

**2. KRITISCH: Temperatur-Skalierung fehlt**

Aktueller Code:
```js
const tempValue = Math.round(temperature * 10);  // 21°C → 210
if (tempValue < 50 || tempValue > 350) throw ...  // Validierung 5-35°C
```

Neuer Code:
```js
await device.set({ dps: 2, set: temp });  // ❌ Sendet 21 statt 210
```

**Folge:** Thermostat empfängt 21 statt 210 → setzt 2.1°C oder lehnt ab. **Heizung kaputt.**

**3. KRITISCH: `setMode` Logik komplett falsch**

Aktueller Code: `MODE` ist DPS `'1'` mit String-Werten `'auto'`/`'manual'`/`'off'`.

Neuer Code:
```js
async setMode(deviceConfig, mode) {
  const modeValue = mode === 'heat';  // boolean
  await device.set({ dps: 4, set: modeValue });  // ❌ DPS 4 ist HEATING-Status (read-only!)
}
```

**Folge:** Schreibt einen Boolean auf den Heizstatus (statt Mode-String auf DPS 1). TGP508 ignoriert das oder reagiert undefiniert. `manual`-Modus wird nie aktiviert → interne Zeitprogramme bleiben aktiv → **Override-Logik kaputt**.

**4. Zurück-Schritt: Keine Retry-Logik**

Aktueller Code hat 3 Retries mit Exponential Backoff. Neuer Code: **0 Retries**. Bei einem einzelnen WLAN-Glitch fällt der Befehl sofort durch.

**5. Zurück-Schritt: Status-Response unvollständig**

Aktueller Code liefert `mode` und `raw_dps` mit. Neuer Code: weg. Das bricht ggf. die Sync-Logik im `index.js`, die `mode` für Override-Erkennung braucht.

**6. Zurück-Schritt: Kein `device.find()` vor `connect()`**

Aktueller Code ruft `device.find()` vor `connect()` — wichtig wenn IP wechselt (DHCP). Neuer Code verlässt sich nur auf statische IP. Bei IP-Wechsel hängt `connect()` bis zum 5s-Timeout.

**7. Fehlt: Cooldown zwischen Operationen** und **Circuit Breaker** (siehe vorheriger Plan).

### Fazit

| Aspekt | Bewertung |
|---|---|
| **Architektur (Queue + Timeout)** | ✅ Gut — löst Hauptproblem |
| **Implementierung (DPS, Skalierung, Mode)** | ❌ Mehrere kritische Bugs — würde Heizung **brechen** |
| **Robustheit (Retry, Find, Mode-Setup)** | ❌ Schlechter als aktueller Code |

**Der Code löst das Hänge-Problem grundsätzlich richtig (Queue + Timeout), aber wenn er so deployed wird, funktioniert die Heizungssteuerung danach nicht mehr** — wegen DPS-Verwechslung, fehlender `*10`-Skalierung und falscher `setMode`-Logik.

---

## Empfehlung: Hybrid-Ansatz

Übernehme die **3 guten Ideen** des Copilot-Codes, aber behalte die **funktionierende Logik** des aktuellen Codes bei.

### Plan

**Datei:** `local-collector/collector-node/tuya-thermostat.js`

| Aus Copilot übernehmen | Aus aktuellem Code behalten |
|---|---|
| ✅ `enqueue(deviceId, fn)` — Per-Device-Queue | ✅ Korrektes DPS-Mapping (`MODE='1'`, `CURRENT_TEMP='3'`) |
| ✅ `safeConnect()` mit 5s-Timeout | ✅ Temperatur × 10 Skalierung + Validierung 5-35°C |
| ✅ `safeDisconnect()` immer im finally | ✅ `setMode()` setzt `dps:'1'` mit String `'auto'`/`'manual'`/`'off'` |
| ✅ `issueGetOnConnect: false` | ✅ `setTemperature()` setzt erst `mode='manual'` dann `target_temp` |
| | ✅ `device.find()` vor `connect()` |
| | ✅ Retry-Logik (3× mit Backoff) — aber innerhalb der Queue, nicht außerhalb |
| | ✅ `mode` und `raw_dps` in Status-Response |

### Struktur-Skizze

```js
async setTemperature(deviceConfig, temperature) {
  return this.enqueue(deviceConfig.device_id, async () => {
    return this._setTemperatureWithRetry(deviceConfig, temperature, 0);
  });
}

async _setTemperatureWithRetry(deviceConfig, temperature, retryCount) {
  const device = this.getDevice(deviceConfig);
  const tempValue = Math.round(temperature * 10);
  if (tempValue < 50 || tempValue > 350) return { success: false, error: 'out of range' };
  
  try {
    await device.find();
    await this.safeConnect(device);  // mit 5s Timeout
    await device.set({ dps: '1', set: 'manual' });
    await device.set({ dps: '2', set: tempValue });
    return { success: true };
  } catch (err) {
    if (retryCount < 3) {
      await this.sleep(1000 * (retryCount + 1));
      return this._setTemperatureWithRetry(deviceConfig, temperature, retryCount + 1);
    }
    return { success: false, error: err.message };
  } finally {
    await this.safeDisconnect(device);  // IMMER
  }
}
```

### Nicht ändern
- `index.js` (Aufrufer) — keine API-Änderung nötig
- DB-Schema, Frontend, Edge Functions

### Erwartetes Ergebnis

| Symptom | Vorher | Nach Hybrid-Fix |
|---|---|---|
| Hängende Promises (paralleler Zugriff) | Häufig | Eliminiert (Queue) |
| Hängender `connect()` bei toter IP | Bis ∞ | Max 5s (Timeout) |
| Connection-Leak nach Fehler | Ja | Nein (finally) |
| DPS-Mapping korrekt | ✅ | ✅ (beibehalten) |
| Temperatur-Skalierung korrekt | ✅ | ✅ (beibehalten) |
| Mode-Setting korrekt | ✅ | ✅ (beibehalten) |
| Retry bei Glitch | ✅ 3× | ✅ 3× (beibehalten) |

### Dateien

| Datei | Änderung |
|---|---|
| `local-collector/collector-node/tuya-thermostat.js` | Queue + Timeout-Connect + finally-Disconnect ergänzen, bestehende DPS/Skalierung/Retry/Mode-Logik beibehalten |
| `.lovable/SYSTEM_DOCUMENTATION.md` | Sektion „Local Tuya Service" um Queue/Timeout dokumentieren |
| `mem://deployment/tuya-local-service-implementation` | Update mit Queue + Timeout |
