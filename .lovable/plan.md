
# Plan: Fix ML-Feature-Extraction Edge Function Deployment

## Problem-Analyse

Die Edge Function `ml-feature-extraction` existiert im Code-Repository (`supabase/functions/ml-feature-extraction/index.ts`), ist aber **nicht auf der Lovable Cloud deployed**:

- **Fehler im Frontend**: `FunctionsFetchError: Failed to send a request to the Edge Function`
- **Ursache**: HTTP 404 - "Requested function was not found"
- **Test-Ergebnis**: Direkter Aufruf der Funktion gibt 404 zurueck

Die Funktion ist in `config.toml` korrekt konfiguriert (`verify_jwt = false`), aber wurde offenbar bei einem frueheren Deployment uebersprungen oder nie initial deployed.

## Loesung

### Schritt 1: Edge Function deployen

Die `ml-feature-extraction` Funktion muss auf der Lovable Cloud deployed werden. Dies geschieht automatisch durch das Deploy-Tool.

### Schritt 2: Funktionalitaet testen

Nach dem Deployment wird die Funktion getestet, um sicherzustellen, dass:
- Sie erreichbar ist (kein 404 mehr)
- Sie korrekt Features fuer Raeume berechnet
- Die Ergebnisse in `room_ml_features` gespeichert werden

### Schritt 3: Frontend-Fehler loesen

Sobald die Funktion deployed ist, sollte der "Fehler bei Feature-Berechnung" Toast nicht mehr erscheinen und der Refresh-Button im ML-Status Widget funktioniert.

## Technische Details

Die Edge Function `ml-feature-extraction`:
- Laedt Heizungs-Logs und Temperatur-Samples der letzten 7 Tage
- Berechnet ML-Features wie:
  - `heat_loss_rate_deg_per_hour` - Abkuehlrate
  - `heating_rate_deg_per_hour` - Aufheizrate
  - `energy_per_degree_wh` - Energiebedarf pro Grad
  - `solar_gain_factor` - Solargewinn-Faktor
  - `optimal_solar_hours` - Optimale Heizzeiten
- Speichert Ergebnisse in `room_ml_features` Tabelle

## Erwartetes Ergebnis

Nach Implementierung:
- ML-Status Widget zeigt aktuelle Features
- Refresh-Button laedt neue Features ohne Fehler
- KI-Analyse kann auf aktuelle ML-Daten zugreifen
