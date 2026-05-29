# Handy-Ansicht: 2 weitere Overflow-Fehler beheben

Beide Screenshots zeigen Zeilen, die auf 390px-Breite rechts aus der Karte herauslaufen. Reine Layout-/Responsive-Korrekturen, keine Logik- oder Datenänderung. Desktop bleibt unverändert.

## Fehler 1 — ML-Status Karte (`src/components/heating/LearningProgress.tsx`)

**Problem:** Der Header (`flex items-center justify-between`) drückt auf Mobil zu viel in eine Zeile: Titel „ML-Status" links, rechts die Kompakt-Stats (`Samples · Conf · Ø`) **plus** Button „Analyse starten" **plus** Refresh-Icon **plus** Chevron. Der „Analyse starten"-Button wird abgeschnitten / läuft rechts heraus.

**Lösung:**
- Header-Container auf `flex-col sm:flex-row sm:items-center sm:justify-between gap-2` umstellen, damit auf Mobil zwei Zeilen entstehen (Titel oben, Stats+Buttons darunter).
- Die Stats-/Button-Gruppe `flex-wrap` geben, damit Stats und Buttons bei Bedarf umbrechen.
- Button-Label „Analyse starten" auf Mobil auf „Analyse" kürzen (`<span className="sm:hidden">Analyse</span>` / `<span className="hidden sm:inline">Analyse starten</span>`), Button mit `shrink-0 whitespace-nowrap`.
- Stats-Gruppe `flex-wrap` + `gap` reduzieren, damit `Samples / Conf / Ø` nicht abgeschnitten werden.

## Fehler 2 — Datenspeicherung Aktions-Buttons (`src/components/energy/DataRetentionSettings.tsx`)

**Problem:** Die Button-Zeile am Ende (`<div className="flex gap-3">` mit „Speichern" und „Jetzt bereinigen") läuft rechts aus der Karte heraus, weil „Jetzt bereinigen" (mit Icon) zu breit ist.

**Lösung:**
- Button-Container auf `flex flex-col sm:flex-row gap-3` umstellen.
- Beide Buttons auf Mobil volle Breite (`w-full sm:w-auto`), damit nichts überläuft; auf Desktop nebeneinander wie bisher.

## Nicht betroffen
Desktop-Layout, Datenfluss, Edge Functions, Logik. Es werden nur Tailwind-Klassen in den zwei genannten Dateien angepasst.

## Verifikation
Screenshot der Handy-Ansicht (390px) beider Karten nach der Änderung, um sicherzustellen, dass keine Inhalte mehr abgeschnitten werden und Desktop unverändert bleibt.
