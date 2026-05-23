## KI-Tagesplan einklappbar machen

### Ziel
Die `AIDailyPlanCard` soll standardmäßig eingeklappt sein. Nur Header (Datum, Quelle, "Neu erzeugen") bleibt sichtbar. Inhalt (Strategie, Zeitblöcke, Raum-Tabelle) wird über einen Toggle aufgeklappt.

### Änderungen

**Datei: `src/components/heating/AIDailyPlanCard.tsx`**

1. Neuer State `cardExpanded` (default `false`).
2. Header-Zeile erhält rechts einen Toggle-Button (`ChevronDown`/`ChevronUp`) statt des bisherigen "Neu erzeugen"-Buttons. Der "Neu erzeugen"-Button bleibt, aber der Aufklapp-Toggle kommt dazu — z.B. als Icon-Button neben "Neu erzeugen".
3. Inhalt (Strategie, Zeitblöcke, Raum-Tabelle) wird nur gerendert wenn `cardExpanded === true`.
4. Der bestehende `expanded`-State für die Strategie-Text-Länge bleibt unverändert (betrifft nur das lange Strategie-Text-Truncate innerhalb des aufgeklappten Inhalts).
5. Wenn kein Plan vorhanden ist ("Heute noch kein KI-Tagesplan"), bleibt das wie bisher — nicht eingeklappt, da eh nur eine Zeile.

### Ergebnis
- Kompaktere Übersicht im Dashboard
- Benutzer klappt bei Bedarf auf