

# Raum-Übersicht: Aktuellen Heizmodus anzeigen

## Ziel
In der RoomStatusTable eine neue Spalte "Modus" einfügen, die für jeden Raum anzeigt, ob aktuell auf **Nacht**, **Eco** oder **Komfort** geheizt wird — basierend auf dem Vergleich von `target_temp` mit den konfigurierten `night_temp`, `eco_temp` und `comfort_temp`.

## Logik zur Modus-Erkennung
Für jeden Raum wird `target_temp` verglichen:
- `target_temp <= night_temp` → **Nacht** (blau, Moon-Icon)
- `target_temp <= eco_temp` → **Eco** (gelb, Zap-Icon)
- `target_temp >= comfort_temp` → **Komfort** (orange, Sun-Icon)
- Dazwischen oder kein target_temp → **—**

## Änderungen

### Datei: `src/components/heating/RoomStatusTable.tsx`

**Desktop-Tabelle:**
- Neue Spalte **"Modus"** nach "Ziel" einfügen
- Zeigt farbiges Badge mit Icon: 🌙 Nacht (blau), ⚡ Eco (gelb), ☀️ Komfort (orange)

**Mobile-Ansicht:**
- Modus-Badge neben dem Heizstatus (Heizt/Aus) anzeigen

**Beide Ansichten:**
- Heizstatus-Spalte um Modus-Info erweitern, sodass man sofort sieht: "An — Komfort" oder "Aus — Eco"

### Props
- `HeatingSettings` als zusätzliche Prop hinzufügen (für Fallback-Temperaturen wenn Raum keine eigenen hat) — oder die Raum-eigenen `night_temp`, `eco_temp`, `comfort_temp` direkt nutzen (sind bereits im Room-Type vorhanden)

Da `Room` bereits `night_temp`, `eco_temp`, `comfort_temp` und `target_temp` enthält, werden keine neuen Props benötigt.

### Betroffene Datei
- `src/components/heating/RoomStatusTable.tsx`

