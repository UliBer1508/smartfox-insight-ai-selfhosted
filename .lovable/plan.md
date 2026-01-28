
# Port-Test-Skript fuer Tuya Thermostate

## Uebersicht

Ein standalone Node.js-Skript das prueft, ob die 11 identifizierten Thermostate ueber Port 6668 (TuyAPI LAN-Port) erreichbar sind. Das Skript benoetigt KEINE Local Keys und KEINE Tuya Cloud API - es testet nur die Netzwerk-Erreichbarkeit.

## Bekannte Thermostat-IPs

Aus den Router-Screenshots identifiziert (MAC-Praefix 3C:0B:59 = Tuya/Hangzhou):

| IP | MAC |
|----|-----|
| 192.168.188.42 | 3C:0B:59:BD:8D:07 |
| 192.168.188.43 | 3C:0B:59:BD:8C:61 |
| 192.168.188.68 | 3C:0B:59:BD:73:F0 |
| 192.168.188.78 | 3C:0B:59:BD:83:E1 |
| 192.168.188.79 | 3C:0B:59:BD:B6:17 |
| 192.168.188.107 | 3C:0B:59:BD:81:F1 |
| 192.168.188.114 | 3C:0B:59:BD:80:66 |
| 192.168.188.171 | 3C:0B:59:BD:89:89 |
| 192.168.188.173 | 3C:0B:59:BD:81:96 |
| 192.168.188.186 | 3C:0B:59:BD:79:90 |
| 192.168.188.197 | 3C:0B:59:BD:B2:E0 |

## Funktionen des Skripts

### 1. Port-Test (Hauptfunktion)
```text
node test-tuya.js
```
- Testet alle 11 IPs auf Port 6668 (TCP)
- Zeigt Ergebnis fuer jedes Geraet
- Gibt Zusammenfassung aus

### 2. Einzelner IP-Test
```text
node test-tuya.js 192.168.188.42
```
- Testet nur eine spezifische IP

### 3. UDP Discovery (Optional)
```text
node test-tuya.js scan
```
- UDP Broadcast auf Ports 6666/6667
- Findet Tuya-Geraete die aktiv antworten

## Technische Details

```text
+------------------------------------------+
|           test-tuya.js                   |
+------------------------------------------+
|                                          |
|  KEINE DEPENDENCIES ausser native Node   |
|  - net (TCP Sockets)                     |
|  - dgram (UDP fuer Scan)                 |
|                                          |
|  Ablauf Port-Test:                       |
|  1. TCP Socket erstellen                 |
|  2. Connect zu IP:6668                   |
|  3. Timeout nach 3 Sekunden              |
|  4. Ergebnis: OFFEN oder GESCHLOSSEN     |
|                                          |
+------------------------------------------+
```

## Erwartete Ausgabe

### Erfolgreich (Lokale API verfuegbar):
```text
========================================
   Tuya Port-Test v1.0
========================================

Teste 11 Thermostat-IPs auf Port 6668...

  192.168.188.42:6668   [OFFEN]   Lokale API verfuegbar
  192.168.188.43:6668   [OFFEN]   Lokale API verfuegbar
  192.168.188.68:6668   [OFFEN]   Lokale API verfuegbar
  192.168.188.78:6668   [OFFEN]   Lokale API verfuegbar
  192.168.188.79:6668   [OFFEN]   Lokale API verfuegbar
  192.168.188.107:6668  [OFFEN]   Lokale API verfuegbar
  192.168.188.114:6668  [OFFEN]   Lokale API verfuegbar
  192.168.188.171:6668  [OFFEN]   Lokale API verfuegbar
  192.168.188.173:6668  [OFFEN]   Lokale API verfuegbar
  192.168.188.186:6668  [OFFEN]   Lokale API verfuegbar
  192.168.188.197:6668  [OFFEN]   Lokale API verfuegbar

========================================
Ergebnis: 11/11 Geraete erreichbar

Die Thermostate unterstuetzen lokale LAN-Steuerung!
Naechster Schritt: Local Keys mit TinyTuya abrufen
========================================
```

### Nicht erfolgreich:
```text
========================================
Ergebnis: 0/11 Geraete erreichbar

Die Thermostate unterstuetzen KEINE lokale API.
Nur Cloud-Steuerung moeglich.
========================================
```

## Neue Datei

### local-collector/collector-node/test-tuya.js

Eigenstaendiges Skript mit:

1. **Hardcodierte IP-Liste** - Die 11 bekannten Thermostat-IPs
2. **testPort()** - TCP-Verbindungstest mit Timeout
3. **testAllPorts()** - Paralleler Test aller IPs
4. **udpScan()** - UDP Broadcast Discovery
5. **Farbige Ausgabe** - Gruene/rote Markierung fuer Ergebnisse

## Verwendung

```bash
cd local-collector/collector-node

# Alle Thermostate testen
node test-tuya.js

# Einzelne IP testen
node test-tuya.js 192.168.188.42

# UDP Discovery
node test-tuya.js scan
```

## Was der Test zeigt

| Ergebnis | Bedeutung | Naechster Schritt |
|----------|-----------|-------------------|
| Port OFFEN | Hardware unterstuetzt lokale API | TinyTuya Wizard fuer Local Keys |
| Port GESCHLOSSEN | Keine LAN-Unterstuetzung | Cloud API ist einzige Option |
| Timeout | Geraet nicht erreichbar | IP-Adresse/Netzwerk pruefen |

## Wichtig

- Das Skript benoetigt **keine Installation** (nur native Node.js Module)
- Muss im **gleichen Netzwerk** wie die Thermostate laufen
- Benoetigt **keinen Local Key** - testet nur Erreichbarkeit
- Kann **sofort ausgefuehrt** werden ohne auf Tuya API Quota zu warten
