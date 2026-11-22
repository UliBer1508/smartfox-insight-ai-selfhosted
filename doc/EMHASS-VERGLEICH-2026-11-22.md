# EMHASS im Vergleich – Stufe 1 (22.11.2026)

**Uli, 22.11.2026:**
- „Warum ist die KI nicht in der Lage, die Steuerung zu übernehmen? Ist der Algorithmus nicht gut genug? Schau im Internet
  oder auf GitHub, ob es Beispiele gibt.“
- „Warum versuchen wir nicht das EMHASS- oder RoomMind-Modell? Wir bauen beide zusätzlich ein und sehen, wie sie sich
  gegenüber unserem Modell verhalten. Wir lassen sie nebenher laufen. Wenn wir wissen, welches der Modelle das bessere
  ist, schalten wir es scharf.“
- „Stufe 1 und Brücke zu Supabase. Ob wir den Code ändern, sehen wir, wenn die ersten Ergebnisse da sind.“

## Befund vorher

- Trübe Tage 17.–21.11.: unser Planer 0–1,4 kWh/Tag besser als die Regeln. PV wird schon zu 98 % genutzt (KW 47: 1,7 kWh
  eingespeist) – mehr ist bei festem Tarif an trüben Tagen nicht zu holen.
- Sonnentag 16.11.: Planer 7 kWh **schlechter**. Unser Planer sucht „gierig“ (Raum für Raum, halbe Stunde für halbe
  Stunde, nimmt nichts zurück). EMHASS löst dieselbe Aufgabe als lineares Optimierungsproblem (HiGHS) – findet für sein
  Modell den besten Plan.

## Kandidaten

| | EMHASS | RoomMind |
|---|---|---|
| Quelle | github.com/davidusb-geek/emhass, MIT | github.com/snazzybean/roommind, MIT |
| Rechenwerk | lineare Optimierung (HiGHS/cvxpy), ganzes Haus, PV + Batterie | dynamische Programmierung **je Raum** |
| Raummodell | ein Speicher je Raum (Aufheizrate, Abkühlkonstante, Verzögerung) | ein Speicher, lernt laufend (Kalman-Filter) |
| PV/Batterie | ja | nein – nur Strompreis-Signal, keine gemeinsame PV, keine Batterie |
| Läuft ohne Home Assistant | ja (Python, Befehlszeile) | nein (Home-Assistant-Erweiterung) |

→ Zuerst EMHASS (Stufe 1). RoomMind passt schlechter (plant jeden Raum einzeln, kennt PV und Batterie nicht); sein
Kalman-Lernen bleibt als Idee für unser Raummodell.

## Aufbau

```
Österreich-PC  C:\EMHASS  (EMHASS 0.18.11, Python 3.14 venv)
  Aufgabe „EMHASS Vergleich“ täglich 03:45 → emhass_bruecke.py
     1. POST heizplaner {aktion: emhass_eingabe, tag}      ← Daten der Gegenrechnung im EMHASS-Format
     2. emhass --action naive-mpc-optim (HiGHS)             → Leistung je Raum und 30 min
     3. POST heizplaner {aktion: emhass_bewerten, tag, plan} → bewertet mit unserem Raummodell
                                                              → heizplan_vergleich.emhass
Anzeige: Auto-Steuerung › Wo stehen wir? › Gegenrechnung, Spalte „Netz EMHASS“
```

**Fair:** EMHASS bekommt genau die Daten der Gegenrechnung (echte PV ab Mitternacht, Temperaturen um Mitternacht,
Batteriestand, Außentemperatur, Grundlast, nicht steuerbare Räume wie in echt) und wird mit **demselben Maßstab**
bewertet wie die tatsächliche Steuerung und unser Planer (`bewerte`: Raummodell mit Estrich, Batterie-Logik des
Fronius). Netz bereinigt um die Wärme am Tagesende (wie beim Planer).

## Stufe 1 – EMHASS fast im Original, unsere Daten und Regeln als Grenzen

| Was | Wie |
|---|---|
| Raumwerte | aus unserem gelernten Zwei-Speicher-Modell (`heizmodell`) abgeleitet: Abkühlkonstante = langsamste Eigenzeit, Aufheizrate so, dass der Dauerzustand gleich ist (ΔT = r·g/k), Verzögerung = schnelle Eigenzeit (≤ 3 h) – `emhassRaumwerte` |
| Innere Wärme c | als Temperatur-Verschiebung je Raum (−c/k), im Ein-Speicher-Modell gleichwertig. Ohne das: keine Lösung (Waschraum c/k = 9,5 °C) |
| Sonnengewinn s·PV | nicht berücksichtigt (EMHASS heizt dadurch eher etwas mehr) |
| Min | harte Untergrenze; was laut Modell selbst bei Dauerheizen nicht haltbar ist, wird begrenzt (im Log gemeldet) |
| Normal | Wunschwert mit Strafe (unser Gewicht 0,6 je °C·h × Raumgewicht, in € umgerechnet) – nur wo die Regeln Normal aus dem Netz erlauben (Tag ohne genug Sonne) |
| PV-Max | Obergrenze (nie unter der Starttemperatur) |
| „Abend/Nacht nur Min“ | Netzpreis +50 % in Schritten, in denen die Regeln nur Min erlauben und keine PV da ist. Ohne Aufschlag heizte EMHASS im Test nachts vor, um morgens Normal zu erreichen (fester Tarif = Uhrzeit egal) |
| Batterie | 13,8 kWh, 5,5/5,7 kW, Wirkungsgrad 95 %, Ende = Anfang (sonst leert EMHASS sie „gratis“) |
| Leistungsgrenze | `maximum_power_from_grid` = Grenze + Grundlast |

Proben 22.11.2026 (Beispieldaten, hier im Container mit derselben Version): Lösung „Optimal“ in 6–22 s.

## Einrichten (Österreich-PC)

1. `C:\EMHASS` mit venv, `pip install emhass` (erledigt 22.11.2026, EMHASS 0.18.11)
2. Dateien aus `emhass/` im Repo nach `C:\EMHASS` kopieren: `emhass_bruecke.py`, `basis_config.json`,
   `secrets_emhass.yaml` (ohne Home Assistant: `hass_url`/`long_lived_token` = `empty`), `einrichten.ps1`
3. Supabase-Schlüssel: die Brücke liest ihn aus `C:\Users\ulibe\smartfox-collector\config.json` (wie der Fronius-Dienst)
4. Nachtrag der letzten Tage: `C:\EMHASS\venv\Scripts\python.exe C:\EMHASS\emhass_bruecke.py --tage 7`
5. Aufgabe anlegen: `powershell -ExecutionPolicy Bypass -File C:\EMHASS\einrichten.ps1` (als Administrator)

Protokoll: `C:\EMHASS\bruecke.log`, je Tag `C:\EMHASS\laeufe\<tag>\` (Konfiguration, Eingaben, EMHASS-Ausgabe).

## Dateien

- `supabase/functions/heizplaner/emhass.ts` – Eingaben bauen, Plan bewerten
- `supabase/functions/heizplaner/rechnen.ts` – `vergleichBasis` (ausgelagert aus `vergleichAus`, unverändert im Ergebnis)
- `supabase/functions/heizplaner/index.ts` – Aktionen `emhass_eingabe`, `emhass_bewerten`
- `supabase/SQL/51_emhass_vergleich.sql` – Spalte `heizplan_vergleich.emhass` (ausgeführt 22.11.2026)
- `emhass/` – Brücke, Grundkonfiguration, Einrichtung für den Österreich-PC
- `src/components/ki/KiGegenRegeln.tsx` – Spalte „Netz EMHASS“

## Auswertung / nächste Schritte

- Nach ~2 Wochen (mit Sonnentagen): EMHASS gegen Planer und Regeln – Netz bereinigt, unter Min.
- EMHASS besser an Sonnentagen → Stufe 2/3: Estrich als eigener Speicher bzw. unser Raummodell in EMHASS; oder unser
  Modell mit HiGHS statt gieriger Suche.
- Scharf schalten erst nach Ulis Entscheidung (Grundsatz 13.11.2026).
