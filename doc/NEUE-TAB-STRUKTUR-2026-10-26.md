# Neue Tab-Struktur: Übersicht · Analyse · KI · Einstellungen

**Datum:** 26. Oktober 2026
**Repo:** `UliBer1508/smartfox-insight-ai-selfhosted`
**Betroffen:** nur Frontend (Vercel). Keine Edge Function, keine Datenbank-Änderung, kein Deploy nötig.
**Mockup:** Claude-Design-Canvas „Heizung Venediger – Analyse-Tab“ (Struktur, Analyse, Umzugsliste)

**Zusammenfassung:** Die fünf Tabs waren nach ihrer Entstehung sortiert (Lovable), nicht nach Zweck.
Live-Werte, Rückblick, KI und Einstellungen lagen gemischt; die KI-Vorschläge waren auf drei Tabs
verteilt, die meisten Auswertungen eingeklappt. Jetzt gibt es vier Tabs, jeder beantwortet eine Frage.
Neu: Die Analyse leitet aus einem abgeschlossenen Tag konkrete Einstellungs-Vorschläge ab, die nach
Bestätigung angewendet und protokolliert werden.

| Tab | Frage | Inhalt |
|---|---|---|
| **Übersicht** | Was passiert jetzt? | Statuszeile, Fehlerbanner, Hinweis auf offene KI-Vorschläge, Betriebsmodus, Energie, Energiefluss (aufklappbar), Wetter/Prognose, Raumkarten mit Übersteuern, Raum-Status & Heizleistung |
| **Analyse** | Wie lief es? | Tag (letzte 7 Tage) / Woche / Monat / Jahr; Kacheln, „Das Wichtigste“ mit Vorschlägen, 1 PV, 2 Batterie, 3 Heizung je Raum, 4 Kosten, 5 Prognose & Wetter, 6 Räume & Sonne |
| **KI** (Zähler am Tab) | Was schlägt die KI vor? | Autopilot-Status, KI-Status; 1 Zu entscheiden (Batterie-Empfehlung, Preis-Vorschläge, Parameter-Vorschläge mit Übernehmen/Ablehnen + Protokoll, Automatik-Status); 2 Heute (Tagesplan); 3 Lernen & Qualität; 4 Auswertungen (Musteranalyse) |
| **Einstellungen** | Wie soll es arbeiten? | Betrieb, Haus, Räume, **Heiz-Reihenfolge** (neu), **KI** (neu: Autopilot, Modus je Parameter, Mustergedächtnis, Zeitplan & Datenpflege), Datensammler + Systeminfo, Tuya Cloud, Speicher, Sicherung, Tarife |

Regel für neue Karten: *jetzt?* → Übersicht · *war?* → Analyse · *KI?* → KI · *wie soll?* → Einstellungen.

## 1. Umzugsliste (jede Karte nachgewiesen)

| Karte | vorher | jetzt |
|---|---|---|
| Energiefluss | Energie | Übersicht (aufklappbar) |
| Verbindung / Datenalter | Energie | Übersicht › Statuszeile (`ConnectionStatus` entfernt) |
| KI-Batterie-Empfehlung | Energie | KI › 1 Zu entscheiden |
| Automations-Status (Gate, SOC, Mikro, Nacht) | Energie | KI › 1 Zu entscheiden |
| Tagesstatistik (`EnergyStats`) | Energie | Analyse › Kacheln (Komponente entfernt) |
| Leistungsverlauf (`EnergyChart`) | Energie | Analyse › 1 PV-Anlage, neue Tageskurve (Komponente entfernt) |
| Batterieverlauf, Batterie-Gate-Verlauf | Energie | Analyse › 2 Batterie |
| Systeminfo | Energie | Einstellungen › Datensammler |
| Fehlerbanner | Heizung & KI | Übersicht (oben) |
| Batterie-Status, PV-Leistung heute | Heizung & KI | entfallen – doppelt zu Übersicht/Analyse |
| KI-Status | Heizung & KI | KI (oben) |
| KI-Parameter-Vorschläge | Heizung & KI | KI › 1 Zu entscheiden (+ Ablehnen, Filter „Zu entscheiden“) |
| KI-Autopilot an/aus | Heizung & KI | Einstellungen › KI |
| Modus je Parameter | nur im aufgeklappten Vorschlag | Einstellungen › KI (eigene Liste) |
| KI-Tagesplan | Heizung & KI | KI › 2 Heute |
| Preis-Vorschlag | Heizung & KI | KI › 1 Zu entscheiden |
| Kosten | Heizung & KI | Analyse › 4 Kosten |
| Raum-Übersicht (Status, Leistung, Kapazität) | Heizung & KI | Übersicht (Priorität dort nur Anzeige) |
| Raum-Priorität bearbeiten | Heizung & KI | Einstellungen › Heiz-Reihenfolge (▲▼ tauschen) |
| Tagesprogramm | Heizung & KI | aufgelöst: Modus → Übersicht, Temperaturen → Einstellungen › Räume |
| KI-Lernstatus, ML-Folgerate | Heizung & KI | KI › 3 Lernen & Qualität |
| Mustergedächtnis | Heizung & KI | Einstellungen › KI |
| PV-Prognose, Prognose vs. Realität | Heizung & KI | Analyse › 5 Prognose & Wetter |
| Batterie-Reserve | Heizung & KI | Analyse › 2 Batterie |
| Heizverlauf, Heizverbrauch Monat/Jahr | Heizung & KI | Analyse › 3 Heizung |
| Solargewinn | Heizung & KI | Analyse › 6 Räume & Sonne |
| Eigenverbrauch-Cockpit, Jahrestrend | Verlauf & Muster | Analyse (Tag aufklappbar, Woche/Monat/Jahr) |
| KI-Musteranalyse | Verlauf & Muster | KI › 4 Auswertungen |
| Automatik-Zeiten, Datenpflege | Verlauf & Muster | Einstellungen › KI |
| Hinweis „Räume & Automatik“ | Verlauf & Muster | entfallen (Verweistext) |

## 2. Tagesauswertung (`src/lib/dayAnalysis.ts`, `useDayAnalysis`)

Quelle: `energy_readings` (5 min, **7 Tage aufbewahrt** → Tagesdetails nur für die letzten 7 Tage) und
`room_temperature_samples` (je Raum ~5 min, mit `is_heating`). Seitenweise geladen (1000-Zeilen-Grenze).

- Integration je Messwert über die Zeit bis zum nächsten (Lücken > 15 min werden nicht überbrückt).
- Heizenergie = Raumleistung (`getEffectiveHeatingPower`) × Zeit mit `is_heating` (Sample ≤ 15 min alt).
- Herkunft der Heizenergie je Intervall: Netzbezug zuerst, dann Batterie-Entladung, Rest Sonne (konservativ).
- PV-Verwendung: Einspeisung und Batterieladung zuerst, Rest Eigenverbrauch (Heizung aus Sonne, sonst Haus).
- Prognose-Linie: `pv_forecasts.hourly_watts` (Rohwerte) auf die gespeicherte, saisonal korrigierte `expected_kwh` skaliert.
- Wiener Kalendertag inkl. Zeitumstellung (25.10.2026 = 25 Stunden).
- Heizdaten vor dem **24.10.2026** sind unzuverlässig (Treiber v1.3) – wird angezeigt, keine Vorschläge.

Geprüft mit künstlichen Tagen (bekanntes Ergebnis): PV 32,00 kWh, Verbrauch 14,00, Einspeisung 23,00,
Netz 8,00, Laden 3,00, Heizung 2,00 aus Sonne, Haus aus PV 4,00 – alle exakt.

## 3. „Das Wichtigste“ und Vorschläge (`src/lib/analysisFindings.ts`)

| Befund | Bedingung | Vorschlag (nur abgeschlossene Tage, nur Whitelist) |
|---|---|---|
| Eingespeist, während Räume unter Komfort | ≥ 1 kWh Einspeisung bei ≥ 500 W, während Räume mit Automatik + PV-Automatik < Komfort − 0,3 °C, nicht heizend und heute noch nicht auf Komfort (Estrich-Sättigung ausgenommen) | Wenn die typische Einspeisung **unter** `pv_surplus_threshold_on` lag, aber für den kleinsten wartenden Raum gereicht hätte (≥ 80 % seiner Leistung): Schwelle auf diese Einspeisung senken (auf 50 W abgerundet, ≥ Whitelist-Minimum, ≥ Schwelle AUS + 100). Sonst kein Vorschlag, sondern Hinweis (Raum zu groß → Reihenfolge/Mikro-Budget; Schwelle nicht die Ursache → KI-Protokoll). |
| Heizung aus dem Netz | ≥ 0,5 kWh | Nur wenn ≥ 1 kWh nachts, ≥ 50 % nachts und Modus „Nacht-Temperatur halten“: `night_heating_mode` → `frost_only` (Nachteil im Dialog genannt) |
| Nacht-Reserve verfehlt | SOC zu Nachtbeginn < `battery_reserve_for_night_soc` | kein eigener Vorschlag – Verweis auf die KI-Batterie-Empfehlung (SOC-Grenzen laufen nur dort) |
| Prognose daneben | PV < 75 % oder > 125 % der Prognose | – |
| Alles gut | sonst | – |

Geprüft: Schwelle 800 W bei typisch 600 W Einspeisung → Vorschlag 800 → 600; bei Schwelle 600 W kein Vorschlag.

**Anwenden** (`src/lib/aiParameters.ts`, gemeinsam mit den KI-Parameter-Vorschlägen):
Dialog zeigt aktuell → neu + Begründung → Bestätigung → aktueller DB-Wert wird gelesen; weicht er vom
angezeigten ab, wird **nicht** geschrieben → nur die eine Spalte wird geschrieben → Eintrag in
`ai_parameter_decisions` (`decision_mode = 'applied'`, `applied_by = 'user (Analyse)'`,
`context_snapshot.source = 'Analyse'`). `ai-parameter-evaluator` bewertet ihn nach ~18 h wie jede
KI-Entscheidung (kein Auto-Rollback, da `auto_applied = false`).

## 4. Kleinere Änderungen und Funde

- **Kosten-Widget schreibt den heutigen Tag:** `useEnergyCosts` speichert die übergebenen Werte als
  heutigen Tag in `energy_daily_costs`. In der Analyse bekommt es deshalb immer die Werte von **heute**,
  nie die des gewählten Tags; die Tageskosten des gewählten Tags rechnet die Analyse selbst.
- **Whitelist-Fehler `parallel_heating_capacity`:** zeigt auf `system_settings.parallel_heating_capacity`,
  das ist der von pv-automation bei jedem Lauf neu geschriebene Heizplan (Objekt), kein Grenzwert.
  Ein übernommener Zahlwert würde sofort überschrieben. Die App blendet den Eintrag aus und wendet ihn
  nicht an. Zum Abschalten in der Datenbank (optional):
  ```sql
  update ai_parameter_whitelist set enabled = false,
    notes = coalesce(notes,'') || ' [26.10.2026: kein Grenzwert, sondern Heizplan von pv-automation]'
  where parameter_key = 'parallel_heating_capacity';
  ```
- KI-Parameter-Vorschläge: neuer Filter „Zu entscheiden“ (Standard), Knopf **Ablehnen**
  (`decision_mode = 'rejected'`), Liste standardmäßig aufgeklappt.
- Raum-Status-Tabelle: ohne Bearbeitungsrecht nur Anzeige der Priorität; Titel „Raum-Status & Heizleistung“.
- Heiz-Reihenfolge: Tausch in drei Schritten (A → NULL, B → alt A, A → alt B), weil `rooms.priority` UNIQUE ist;
  vorher Prüfung, ob die angezeigten Nummern noch stimmen.
- Zeitplan-Felder werden als Funktion statt als eigene Komponente gerendert (kein Fokusverlust beim Tippen).

## 5. Dateien

Neu: `src/components/analysis/AnalysisTab.tsx`, `src/components/analysis/ProposalDialog.tsx`,
`src/components/ki/KiTab.tsx`, `src/components/ki/KiAnalysisRuns.tsx`,
`src/components/settings/AnalysisScheduleSettings.tsx`, `src/components/settings/ParameterAutonomySettings.tsx`,
`src/components/settings/RoomPriorityList.tsx`, `src/hooks/useDayAnalysis.ts`, `src/hooks/useKiPending.ts`,
`src/lib/dayAnalysis.ts`, `src/lib/analysisFindings.ts`, `src/lib/aiParameters.ts`.

Geändert: `src/pages/Index.tsx`, `src/components/energy/Header.tsx`, `src/components/energy/SettingsPanel.tsx`,
`src/components/overview/HouseOverview.tsx`, `src/components/heating/AIShadowDecisions.tsx`,
`src/components/heating/RoomStatusTable.tsx`, `src/components/settings/RoomsSection.tsx`.

Entfernt (Inhalt umgezogen oder ersetzt): `HeatingDashboard.tsx`, `DailyHeatingSchedule.tsx`,
`BatteryStatus.tsx`, `AnalysisPanel.tsx`, `EnergyStats.tsx`, `ConnectionStatus.tsx`, `EnergyChart.tsx`,
`hooks/useHeatingAnalysis.ts`.

Geprüft: `vite build` ok; `tsc` nur noch 3 bekannte Altfehler (usePvAccuracy, useRooms) – vorher 5.

## 6. Offen

1. Nach ein paar Tagen echter Heizdaten prüfen, ob die Vorschlags-Regeln zu oft/zu selten auslösen.
2. `solar_limit_stop` zählt weiter als Heizenergie in Verbrauch/Tageswertung (siehe FIX-HEIZZYKLEN).
   Die neue Analyse rechnet Heizenergie aus `is_heating` und ist davon nicht betroffen.
3. Optional: SQL oben für `parallel_heating_capacity` ausführen.
4. `useKiPending` fragt an drei Stellen ab (Kopfzeile, Übersicht, KI) – bei Bedarf zentralisieren.
