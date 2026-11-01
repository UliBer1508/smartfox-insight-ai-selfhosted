# Thermostat-Datenpunkte TGP508 (BEOK)

**Stand:** 01.11.2026 · **Quelle:** Tuya-Datenmodell baugleicher BEOK-Thermostate (TCC31, TOL47) aus den
Geräte-Anfragen bei tuya-local, abgeglichen mit unseren Auslesungen (`dump-dps.js`, `dump-all.js`, 01.11.2026).
Der TGP508 hat dieselbe Datenpunkt-Liste wie der BEOK TCC31. Bedeutungen ohne „✓“ sind übernommen, nicht am
eigenen Gerät geprüft.

| DP | Tuya-Code | Typ | Bereich | Bedeutung | bei uns (01.11.) |
|---|---|---|---|---|---|
| 1 | switch | bool | – | Gerät ein/aus ✓ | true |
| 2 | temp_set | Zahl, ×0,1 °C | 50–950 | Solltemperatur ✓ | – |
| 3 | temp_current | Zahl, ×0,1 °C | – | Ist-Temperatur ✓ | – |
| 4 | mode | Text | home, auto, temporary | Modus: home = manuell, auto = Wochenprogramm ✓ | home |
| 5 | work_state | Text | "0", "1" | heizt (Relais) ✓ | – |
| 9 | child_lock | bool | – | Kindersicherung | false |
| 11 | fault | Bitmap | E01 | Fehler (E01 = Fühler) | 0 |
| 15 | upper_temp | Zahl, °C | 15–95 | Obergrenze Solltemperatur | 60 |
| **19** | **temp_correction** | Zahl, ×0,1 °C | −99…99 | **Temperatur-Korrektur** | **−10 = −1,0 °C** (alle) |
| **101** | **qidongwencha** | Zahl, ×0,1 °C | 5–100, Schritt 5 | **Einschalt-Differenz** („Ausgang-Start-Temperaturdifferenz“) | **10 = 1,0 °C** (alle) |
| 102 | xianwen | Zahl, °C | 25–95 | Temperaturbegrenzung Fühler (Boden-Übertemperatur) | 60 |
| 103 | frost | bool | – | Frostschutz des Geräts | gemischt |
| 104 | reset | bool | – | Werkseinstellung | false |
| 105 | night_mode | Rohdaten | – | Nachtprogramm (Zeiten) | nicht gemeldet |
| 106 | window_check (TCC31) / backlight (TOL47) | – | – | Fenster-Erkennung bzw. Hintergrundlicht – bei uns Text "3", eher Hintergrundlicht | "3" |
| 107 | window_state / leave_temp | – | – | unklar | "1" |
| 108 | zhufan | bool | – | Ausgang umkehren | false |
| 109 | sound | bool | – | Tastenton | true |
| 110 | sensor_choose | Text | "1", "2", "3" | Fühlerwahl (1 = Raumfühler im Gerät, vermutlich 2 = Boden, 3 = beide) | "1" |
| **111** | **dormant_switch** | bool | – | **Nachtmodus des Geräts ein/aus** | **an:** Toilette Eingang, Wirtschaftsraum, Zimmer Uli, Büro, Wohnzimmer, Zimmer Luis · **aus:** Rest |

## Was das für die Steuerung heißt

- **DP 19 = −1,0 °C** an allen Geräten. Gemessen regeln alle Räume um Soll **+0,6 bis +0,7 °C**
  (Protokoll › Thermostate, 3 Tage). Das passt zu einer Korrektur, die auf die Regelung anders wirkt als
  auf die gemeldete Temperatur. **Test:** Büro DP 19 = 0, dann Ist-Wert und „Ein/Aus bei“ beobachten.
  **Ergebnis 01.11.2026, 17:52:** Büro DP 19 −10 → 0. Die gemeldete Ist-Temperatur blieb gleich (19,4 → 19,3 → 19,4).
  DP 19 verschiebt also **nicht** die gemeldete Temperatur – die gemeldeten Werte sind echt, die Räume lagen
  26.–31.10. wirklich unter ihrer Untergrenze. Offen: Wirkt DP 19 auf den Schaltpunkt? → „Ein/Aus bei“ im Büro ab 02.11.
  beobachten (vorher +0,48 / +0,59).
- **DP 101 = 1,0 °C Einschalt-Differenz.** Trotzdem takten manche Räume sehr kurz (Wohnzimmer alle 7 min).
  Zusammen mit DP 19 erst nach dem Test bewerten.
- **DP 111 Nachtmodus** ist bei 6 Räumen an. Das Gerät hat damit ein eigenes Nachtprogramm (DP 105) – mit
  seiner falschen Uhr (~12 h versetzt). Es kann Sollwerte zu falschen Zeiten ändern. Die Nacht regelt
  `pv-automation`; der Gerätenachtmodus sollte **überall aus** sein (DP 111 = 0).
- **DP 110 = "1":** Es regelt der Raumfühler im Gerät, kein Bodenfühler.
- **DP 102 = 60 °C** Fühlergrenze ist für Fußbodenheizung hoch, wirkt bei Fühlerwahl „1“ aber nicht.

Ändern: Tab **Protokoll › Thermostate › Thermostat-Einstellung testen** (freigegeben: DP 19, 101, 103, 111).
Jede Änderung steht mit altem und neuem Wert im Protokoll.

## Quellen

- BEOK TCC31, Datenmodell: https://github.com/make-all/tuya-local/issues/6341
- BEOK TOL47, Datenmodell: https://github.com/make-all/tuya-local/issues/4262
