
## Erkenntnisse: TGP508 Thermostat Mode-Analyse

### Untersuchungsergebnis

Die Tuya API-Spezifikation (`/v1.0/devices/{id}/specifications`) zeigt:
- `mode` Enum unterstützt nur `["auto"]` über Cloud-API
- Der `home` Mode wird direkt am Gerät gesetzt und kann **nicht** über die Cloud geändert werden

### Bedeutung der Modi

Laut Beok TGP508 Manual:
- **`home` mode** = Non-programmable mode → Akzeptiert direkte temp_set Befehle
- **`auto` mode** = Programmable mode → Folgt internem Zeitplan

### Aktueller Status

✅ Alle 10 Thermostate sind im `home` mode (korrekt!)
✅ Cloud-Befehle (temp_set) werden akzeptiert und ausgeführt
✅ Das Nachtmodus-Problem wurde durch den Fix in `pv-automation` gelöst

### Implementierte Änderungen

| Datei | Änderung |
|-------|----------|
| `supabase/functions/tuya-control/index.ts` | Neuer Endpoint `/device-spec` zum Abrufen von Gerätespezifikationen |
| `supabase/functions/tuya-control/index.ts` | `/set-mode-all` Endpoint - setzt verfügbaren Mode (derzeit nur `auto`) |
| `supabase/functions/pv-automation/index.ts` | Nachtmodus-Fix: Thermostate werden aktiv auf night_temp gesetzt |

### Fazit

Der Mode-Wechsel ist **nicht notwendig** - die Thermostate sind bereits korrekt konfiguriert. Das eigentliche Problem war die fehlende Nachtmodus-Logik in `pv-automation`, die jetzt implementiert ist.
