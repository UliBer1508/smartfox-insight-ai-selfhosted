# 🔴 PFLICHTLEKTÜRE VOR JEDER ÄNDERUNG

## Reihenfolge:
1. **`KONZEPT-TAGESABLAUF-HEIZUNG-2026-10-27.md`** — Grundkonzept (wie die Heizung arbeiten soll). Vor jeder Änderung an der Steuerung lesen.
2. **`SYSTEM_DOCUMENTATION.md`** — Master-Dokument (Konzept, Algorithmen, Budget-Logik, Tuya-Quota, Batterie-Reserve, ML, alle Edge-Functions). **IMMER zuerst lesen.**
3. **`memory/index.md`** — Index aller Memory-Files (Detail-Specs)
4. **`memory/<topic>.md`** — Bei Bedarf für tiefe Specs
5. **`plan.md`** — Aktueller Plan (falls vorhanden)

## Regel:
> **Konzept hier ist die Wahrheit — Code wird daran angepasst, NICHT umgekehrt.**
>
> Bestehende Logik **erweitern, nicht überschreiben**. Bei Konflikt mit User-Wunsch → nachfragen.
>
> Nach jeder Änderung: Master-Doku + Changelog (Sektion 20) aktualisieren.
