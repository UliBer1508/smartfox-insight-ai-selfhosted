Ziel: Tuya-Tagesquote nicht mehr sprengen, ohne die "Überschuss-Umverteilung" kaputt zu machen. Strategie wird von prädiktiv (Vorausberechnung "effective Export") auf **reaktiv** (warten bis Zähler echten Überschuss zeigt) umgestellt.

## Was geändert wird

### 1. Dashboard-Auto-Sync abschalten (Cloud-Modus)
- `HeatingDashboard.tsx`: Der 5-Minuten-Auto-Sync wird im Cloud-Modus entfernt.
- Beim Öffnen wird **nur einmal** synchronisiert, falls der letzte Tuya-Sync älter als 60 Minuten ist.
- Manueller Refresh-Button bleibt jederzeit verfügbar.
- Lokaler Modus bleibt unverändert (kein Cloud-Verbrauch).

### 2. `sync-all` mit Last-Sync-Gate
- In `tuya-control/sync-all`: Wenn `last_sync_at` jünger als 60 Min → DB-Daten zurückgeben, kein Tuya-Call.
- Gilt auch für den Sync-Aufruf aus `pv-automation` (Zeile ~1105).

### 3. Reaktive Heizstrategie statt prädiktiver Umverteilung
In `pv-automation/index.ts`:
- **Kein "effective Export"-Trick mehr**: Komfort-Budget = nur **echter Zähler-Export** minus Baseload-Puffer. Heizleistung wird nicht mehr dazugerechnet.
- **Stabilitäts-Filter**: Ein neuer Raum darf erst aktiviert werden, wenn der Überschuss ≥ Schwelle für mindestens 2 aufeinanderfolgende Runs (≈4 Min) stabil war. Verhindert Flackern bei Wolken.
- **Mindest-Heizdauer pro Raum**: 25 Minuten, bevor ein Raum wieder umgeschaltet werden darf (verhindert Ping-Pong).
- **Komfort-Sättigung bleibt**: Raum erreicht Komfort → zurück auf Eco. Aber das frei werdende Budget wird **nicht im selben Run umverteilt** — erst der nächste Run sieht den realen Export am Zähler und entscheidet dann.

### 4. Quota-Gate konsistent
- Einheitliche Berechnung des effektiven Tageslimits in `tuya-control` und `pv-automation` (Monatsrest / verbleibende Tage).
- Log zeigt `calls_today / effectiveDailyLimit / configuredDailyLimit`, damit klar ist, warum bei z.B. 108/200 schon Schluss ist.
- `push-all-temps` bekommt denselben Quota-Gate.

### 5. Datenquelle für Ist-Temperatur
- `current_temp` und `is_heating` werden aus der DB gelesen (über lokalen Collector aktuell gehalten), nicht mehr alle 5 Min via Tuya geholt.
- Nur noch 1 Drift-Check-Sync pro Stunde (über das Last-Sync-Gate gesteuert).

### 6. Memory-Update
- `mem://arch/pv-automation-strategy-v2` und Core-Strategie aktualisieren: "Reaktive Umverteilung" statt "effective Export + parallel-Plan".
- `mem://integration/tuya/api-quota-management-v2` aktualisieren: Dashboard-Sync deaktiviert, sync-Gate 60 Min.

## Was nicht geändert wird
- Phase 1 (Eco) vor Phase 2 (Komfort) bleibt.
- Prioritäten 1–12 bleiben.
- Komfort-Sättigung / Estrich-Speicher bleibt.
- Nacht-/Frostschutz-Logik bleibt.
- ML-/Pre-Heat-Integration bleibt, aber respektiert das neue Quota-Gate.

## Erwartetes Ergebnis
- Tuya-Calls/Tag sinken von ~280+ auf ~30–50.
- Quota wird nicht mehr vorzeitig erschöpft.
- Heizung reagiert ehrlich auf echten PV-Überschuss; bei wechselhaftem Wetter ~3–5 Min langsamer, dafür kein Akku-/Netzbezug durch Fehlprognose.