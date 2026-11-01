---
name: Lernschleife
description: Wie KI/ML lernen dürfen – nur Daten ab 26.10.2026, Tagesnote nach Ulis Zielen, Vorschläge aus bestbewerteten ähnlichen Tagen, Grundregeln nie aufheben
type: constraint
---

**Konzept:** `doc/KONZEPT-LERNSCHLEIFE-2026-11-01.md` (freigegeben 01.11.2026).

- **Datenbeginn:** `system_settings.learning_data_since` = 2026-10-26. Heizungsdaten davor (Thermostate im Modus „auto“,
  „heizt“ immer false, keine Heizzyklen) **nie** zum Lernen verwenden. `update-learned-policies` filtert danach.
- **Ziel = Ulis Ziele**, gemessen in `tages_bewertung` (Note 0–100): Nacht (Batterie reicht bis morgens), Sonne
  (PV im Haus genutzt), Komfort (keine Raum-Minuten unter Untergrenze), Netz (wenig Netzstrom für Heizung).
  Nicht mehr nur „wenig Netzbezug“.
- **Vorschläge** kommen aus den bestbewerteten ähnlichen Tagen, mit nachprüfbarer Begründung; Uli übernimmt.
  Gesperrte Parameter bleiben gesperrt.
- **Grundregeln** (Batterie gehört der Nacht, Sonne zuerst in die Batterie, Untergrenze, nur Thermostate) hebt die KI nie auf.
- Gewichte der Tagesnote stehen im Konzept §4 – dort ändern, nicht im Code verstecken.
