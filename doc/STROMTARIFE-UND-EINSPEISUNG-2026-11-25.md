# Stromtarife & Einspeisung – Salzburg AG und ÖMAG (Stand 25.11.2026)

Quellen: Bestätigungsmail Preisbindung (Salzburg AG), Kundenportal Salzburg AG (Verbrauch + Vertragsübersicht), Produktblätter/Webseite Salzburg AG, Telefonat mit der Salzburg AG am 25.11.2026, ÖMAG-Vertrag vom 15.11.2023.

Die Steuerung in diesem Repo läuft in **Haus 315** (Fronius, 15,8 kWp, Batterie 13,8 kWh). Die Tarife der anderen Häuser stehen hier mit dabei, weil alles über ein Kundenkonto läuft.

---

## 1. Umstellung auf „Strom Preisfix“ (telefonisch genehmigt 25.11.2026)

| Anlage | Zähler | Jahresverbrauch | Tarif neu | Ersparnis/Jahr (brutto, nur Energie) |
|---|---|---|---|---|
| Wald (Trattenbach 299/17, Chalet 17) | Strom | 1.600 kWh | **bleibt Privat 24 + Deckel** | Preisfix wäre ~26 € teurer |
| Wald (Chalet 17) | Heizung | 8.996 kWh | **Preisfix** | ~490–580 € |
| **Venedigersiedlung 315** (dieses System) | Strom (inkl. Heizung über Batterie) | 5.474 kWh | **Preisfix** | ~300 € |
| Venedigersiedlung 316 | Strom | 3.615 kWh | **Preisfix** | ~143 € |
| Venedigersiedlung 316 | Heizung | 10.158 kWh | **Preisfix** | ~575–680 € |

**Gesamt ca. 1.500–1.700 € pro Jahr brutto.** Die Bandbreite ergibt sich aus dem unbekannten Tag-/Nacht-Anteil im alten Wärmetarif; das Wärme-Grundentgelt ist mit ~23 € angenommen.

Rechenweg (brutto): Privat 24 = 36 € + 1.500 × 12,00 ct + Rest × 20,28 ct · Preisfix = 72 € + alles × 11,88 ct · Wärme 24 = ~23 € + 1.500 × 12,00 ct + Rest × 19,08–20,28 ct. Preisfix lohnt sich gegenüber Privat 24 + Deckel ab **~1.900 kWh/Jahr**.

Preisgarantie Preisfix: **bis 30.06.2028**.

---

## 2. Tarife (netto / brutto)

| Tarif | Arbeitspreis | Grundpreis/Jahr | Bemerkung |
|---|---|---|---|
| **Strom Preisfix Privat** | 9,90 / **11,88 ct** | 60 / 72 € | garantiert bis 30.06.2028, keine Bindung, keine Rabatte, **kein Nachttarif** |
| Strom Privat 24 | 16,90 / 20,28 ct | 30 / 36 € | 2027 unverändert; inkl. Netz/Abgaben gesamt 24,95 ct netto/kWh |
| Strompreisdeckel 2027 | 10,00 / 12,00 ct | – | nur für die ersten 1.500 kWh pro Vertrag, Bindung bis 31.12.2027 (gilt nur noch für Wald Strom) |
| Strom Wärme 24 (alt) | Nacht 15,90 / 19,08 ct, Tag 16,90 / 20,28 ct | – | gesamt inkl. Netz ~27,3 / ~28,5 ct brutto |

Netzentgelte und Abgaben kommen bei allen Tarifen dazu, rund 8 ct netto ≈ 9,7 ct brutto pro kWh (Privat-Netztarif).

---

## 3. Verträge (Stand Kundenportal 25.11.2026, vor der Preisfix-Umstellung)

| Anlage | Produkt | Vertragskonto |
|---|---|---|
| Trattenbach 299/17 (Chalet 17 / „Wald“) | Strom Privat 24 | 41063907 |
| Trattenbach 299/17 (Chalet 17 / „Wald“) | Strom Wärme Heizung 24 | 41063907 |
| Venedigersiedlung 315 | Strom Privat 24 | 41243054 |
| Venedigersiedlung 316 | Strom Wärme Heizung 24 | 41491877 |
| Venedigersiedlung 316 | Strom Privat 24 | 41491877 |

Nicht mehr aktiv:
- **Haus 315 – Strom Wärme Heizung 24**: beendet 20.11.2025. Die Heizung in 315 wird über die Batterie gespeist und hängt am Privat-Zähler. **Entscheidung 25.11.2026: kein eigener Heizstrom-Zähler mehr.** Ein separater Wärme-Zähler würde Batterie und PV von der Heizung trennen. Der Tarifvorteil rechtfertigt den Umbau und den verlorenen Eigenverbrauch nicht.
- **Einspeisung Photovoltaik bei der Salzburg AG (Haus 316)**: nur 27.10.–19.12.2023, danach an die ÖMAG übergeben (siehe 4.).

---

## 4. Einspeisung – ÖMAG-Vertrag

| Feld | Wert |
|---|---|
| Vertrag | Abnahme und Vergütung von Ökostrom zum **Marktpreis** (§ 13 ÖSG 2012) |
| Vertragspartner | OeMAG Abwicklungsstelle für Ökostrom AG |
| Abgeschlossen | 15.11.2023 (Antrag 25.10.2023), Förderantragsnummer 271680 |
| Anlage | **Venedigersiedlung 316**, Photovoltaik **4,2 kWp** auf dem Gebäude |
| Einspeisetyp | Überschusseinspeisung, Eigenversorgungsanteil laut Antrag 20 % |
| Zählpunkt | AT0040000574100000000000010295860 |
| Laufzeit | nach gesetzlicher Kontrahierungspflicht, endet automatisch |
| Vergütung | Marktpreis nach § 13 Abs 3 iVm § 41 Abs 1 ÖSG 2012, ändert sich laufend (Quartals-/Monatswert) |

Der Vertrag liegt als PDF bei Uli. Er enthält Bankverbindung und Geburtsdatum und wird **bewusst nicht** ins Repo gelegt.

### ÖMAG-Zahlungen (Kontoauszug)

| Datum | Referenz | Betrag |
|---|---|---|
| 30.10.2026 | 163506: 9359463 | 99,49 € |
| 30.10.2026 | 190079: 9359614 | 38,02 € |

Zwei Referenzen am selben Tag bedeuten **zwei ÖMAG-Verträge**. Laut Uli (25.11.2026) gilt immer: **die höhere Zahlung ist Haus 315, die niedrigere Haus 316** (hier 99,49 € = 315, 38,02 € = 316).

Die ÖMAG zahlt **monatlich**. Die Zahlung vom 30.10.2026 ist die Gutschrift für **September 2026** (Marktpreis 10,168 ct/kWh):
- 315: 99,49 € / 10,168 ct ≈ **980 kWh** eingespeist im September
- 316: 38,02 € / 10,168 ct ≈ **375 kWh** eingespeist im September

Gegenprobe mit den App-Daten: `energie_tag.einspeisung_kwh` passt zur Größenordnung. **`daily_pattern_scores.feed_in_kwh` ist um Faktor 10 zu klein** (September 98,5 kWh statt ~980; Oktober Tag für Tag genau 1/10 von `energie_tag`). Ursache: feste 30-s-Annahme in `get_weekly_energy_summary`, behoben mit SQL 60 (siehe `FIX-TAGESENERGIE-FAKTOR10-2026-11-25.md`).

Marktpreise 2026 laut Forum (inoffiziell, offiziell bei E-Control/OeMAG): Jänner 8,842 · März 5,720 · April–Juni 6,772 · Juli 6,146 · August 8,997 · September 10,168 ct/kWh.

---

## 5. Folgen für die Steuerung (Haus 315)

- **Strompreis in „Tarife & Preisverlauf“** (`energy_price_history`, Quelle der Wahrheit): Aktueller Eintrag seit 01.01.2026 ist **29,9351 ct/kWh** inkl. Netz/Abgaben und Messentgelt (laut Jahresabrechnung 15.10.2026), Grundgebühr **161,30 €/Jahr**, Einspeisung **6,772 ct**. Mit Preisfix sinkt nur der Energieanteil um 20,28 − 11,88 = **8,40 ct**, also neuer Eintrag ab Startdatum ca. **21,54 ct/kWh** und Grundgebühr ca. **197,30 €/Jahr** (+36 €). Noch nicht geändert, erst nach der schriftlichen Bestätigung.
- **Einspeisetarif** (`feed_in_price_cent` = 6,772 ct, Stand Mai/Juni): Seit Juli schwankt der ÖMAG-Marktpreis stark (6,1–10,2 ct). Monatlich nachführen oder einen Jahresmittelwert verwenden.
- **Wert einer kWh Eigenverbrauch** sinkt von ~30 ct auf ~21,5 ct brutto (inkl. Netz) minus Einspeisevergütung, bei 10 ct Marktpreis also ~11,5 ct. Eigenverbrauch und Estrich als Speicher bleiben klar wirtschaftlich. An der Logik ändert sich nichts, nur der Euro-Wert in Auswertungen.
- **Kein Nachttarif mehr:** Batterie nachts aus dem Netz zu laden oder Heizlast ohne PV in die Nacht zu schieben bringt bis Oktober 2027 nichts.
- Der Hinweis in `OptimierungView` („enthält Strompreisdeckel und Frei-Tage“) gilt für 315 ab Preisfix nicht mehr (kein Deckel) – bei Gelegenheit anpassen.

---

## 6. Verbrauch (Kundenportal)

### November 2026 (01.–25.11.) vs. November 2025

| Anlage | Tarif | Nov 2026 | Nov 2025 | Δ |
|---|---|---|---|---|
| 316 | Wärme Heizung | 866,7 kWh | 1.274,7 kWh | −32 % |
| Chalet 17 | Wärme Heizung | 477,9 kWh | 708,4 kWh | −33 % |
| 315 | Privat (inkl. Heizung über Batterie) | 725,7 kWh | 785,8 kWh | −8 % |
| 316 | Privat | 21,5 kWh | 67,5 kWh | −68 % |
| Chalet 17 | Privat | 17,3 kWh | 25,0 kWh | −31 % |

315: Bis 20.11.2025 lief die Heizung über den separaten Wärme-Zähler. Der Vorjahresvergleich ist deshalb nicht aussagekräftig (Nov 2025 bis zum 19. nur ~3 kWh/Tag).

315 Jahresverbrauch 01.10.2025–30.09.2026: **5.473,65 kWh** (Ø 15,0 kWh/Tag, Vorjahr Ø 9,37).

---

## 7. Offene Punkte

- [ ] Schriftliche Bestätigung Preisfix abwarten, Startdatum je Zähler notieren
- [ ] Danach in „Tarife & Preisverlauf“ für 315 ab Startdatum ~21,54 ct (inkl. Netz) und Grundgebühr ~197,30 € eintragen
- [ ] Salzburg AG: Ändert sich bei den bisherigen Wärme-Zählern (Wald, 316) der Netztarif?
- [ ] Einspeisetarif `feed_in_price_cent` (6,772 ct) monatlich nachführen oder Jahresmittel verwenden
- [ ] Faktor-10-Fehler: Ursache gefunden und behoben, siehe `FIX-TAGESENERGIE-FAKTOR10-2026-11-25.md` (SQL 60)
- [ ] **Oktober 2027: WiNAP umsetzen.** Ab 01.10.2027 gilt der Winter-Nieder-Arbeitspreis (Netztarif Okt–März, 23–5 Uhr). Weil Preisfix keinen Nachttarif hat, ist WiNAP dann der einzige Nachtvorteil. Planer/Batterie: Nachtladung und eventuell Heizlast in dieses Fenster legen, wenn tagsüber keine PV erwartet wird.
- [ ] Vor dem 30.06.2028: Anschluss-Tarif nach Preisfix prüfen
