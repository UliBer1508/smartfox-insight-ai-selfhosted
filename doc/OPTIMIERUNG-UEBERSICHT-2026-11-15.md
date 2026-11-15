# Auto-Steuerung › 1 „Wo stehen wir?“ (15.11.2026)

**Wunsch (Uli, 15.11.2026):** „Im Moment sehe ich viele Zahlen, weiß aber nicht, was ich damit anfangen soll.“
Die Seite soll zeigen, **wo wir stehen, wohin wir wollen und wie wir dahin kommen**: Was kostet der Netzstrom, was
spart die PV, ist der Planer besser als die Regeln – und konkrete Anweisungen, was zu ändern ist (KI-Vorschläge).
Mockup: Design-Artefakt „Heizung Venediger – Optimierung (Mockup)“, freigegeben („wir bauen sie so“).
Einbau als **erster, einklappbarer Abschnitt** in Auto-Steuerung.

---

## 1. Aufbau

| Teil | Inhalt | Quelle |
|---|---|---|
| Fazit | ein Satz aus den Ampeln unten | berechnet |
| 1 Wo stehen wir? | Kosten ohne PV · PV-Ersparnis · Netzkosten · davon Heizung (geschätzt) + Balken; vier Ampeln: Sonnenstrom genutzt, Heizstrom je Heizgradtag, Min gehalten, Planer | `optimierung_woche()` |
| 2 Wohin wollen wir? | Ziele „jetzt → Ziel“: kWh je Heizgradtag (Ziel änderbar), Sonnenstrom 100 %, 0 Stunden unter Min | `optimierung_woche()`, `system_settings.optimierung_ziel` |
| 3 Wie kommen wir dahin? | offene KI-Vorschläge mit Übernehmen/Ablehnen, „Haben frühere Vorschläge geholfen?“, So optimiert die Steuerung, Was du drehen kannst | `ki_vorschlaege` (useKiVorschlaege) |
| Verlauf | kWh je Heizgradtag je 7 Tage mit Ziel-Linie (8 Zeiträume) | `optimierung_woche()` |

Zeitraum: die letzten 7 **vollen** Tage bis gestern (Tage mit < 20 Stunden Daten zählen nicht).

### Kennzahlen

- **kWh je Heizgradtag** = Heizstrom ÷ Σ max(0, 18 °C − Außen-Tagesmittel). Wetterunabhängig – das eine Maß, an dem
  jede Änderung gemessen wird. Außentemperatur aus `tages_bewertung.aussen_avg`.
- **Kosten ohne PV** = Σ Verbrauch × Bezugspreis. **PV-Ersparnis** = ohne PV − Netzkosten + Einspeiseerlös
  (enthält die Batterie).
- **davon Heizung** = Netzkosten × Heizung ÷ Verbrauch – **geschätzt nach Anteil**, nicht gemessen.
- **Raum-Stunden unter Min** = `energie_tag.raum_h_nacht_unter`; **unter Normal** = `raum_h_unter_eco` (08–22 Uhr).

Ampeln: Sonne ≥ 95 % gut, ≥ 80 % mittel · Heizstrom ≤ Ziel gut, ≤ Ziel + 15 % mittel · Min ≤ 0,5 h je Nacht gut, ≤ 5 h mittel.

---

## 2. KI lernt sparen (ki-tagesanalyse, Regel 4)

Bisher schlug die KI nur „wärmer“ vor (Regel 1 Min +0,5 °C, Regel 2 mehr Heizleistung). Neu:

**Regel 4 – Spielraum Min/Normal:** Liegt Min ≤ 1 °C unter Normal und hat der Raum an ≥ 3 Tagen Min gehalten und war
tagsüber < 1 h unter Normal → Vorschlag **Min − 1 °C** (nicht unter Normal − 2). Nicht, wenn Regel 2 greift (Haus zu
kalt) oder für den Raum schon „wärmer“ ansteht.

**Wirkungsbericht:** zusätzlich kWh je Heizgradtag 3 Tage vorher/nachher. Spar-Änderungen (neuer Wert kleiner)
werden daran gemessen: besser = ≥ 5 % weniger, schlechter = ≥ 5 % mehr oder Tagesnote − 10. Bei „schlechter“ folgt
wie bisher ein Rücknahme-Vorschlag.

**Stand 15.11.2026 (Probe mit 08.–14.11.):** Regel 4 schlägt **nichts** vor – zu Recht. Kein Raum hielt Min an 3
Tagen; morgens lagen die Räume im Schnitt 0,5–1 °C unter Min und tagsüber rund 10 h unter Normal. Das Haus erreicht
seine eingestellten Temperaturen nicht. Die Seite zeigt das als rote Ampel „Min nicht gehalten“ und im Fazit:
„Zuerst muss Min sicher sein, dann wird gespart.“ (Die Beispiel-Vorschläge im Mockup „Min senken“ waren deshalb
falsch und sind nicht eingebaut.)

---

## 3. Prüfplan – hilft die Seite wirklich?

Uli: „Wir müssen im Laufe der Zeit prüfen, ob sie uns wirklich hilft zu optimieren und das System zu prüfen.“

| Wann | Frage | Woran gemessen |
|---|---|---|
| nach 2 Wochen (29.11.) | Verstehe ich ohne Nachfragen, wo wir stehen und was zu tun ist? | Ulis Urteil; was fehlt/stört |
| | Stimmen die Zahlen? | Kosten gegen Stromrechnung/Fronius, kWh je Heizgradtag gegen Handrechnung |
| | Sinkt die Zahl unter Min gegen 0? | Ampel „Min“, Verlauf |
| | Kamen brauchbare KI-Vorschläge? | Anzahl offen/übernommen/abgelehnt in `ki_vorschlaege` |
| nach 4 Wochen (13.12.) | Sinkt kWh je Heizgradtag Richtung Ziel? | Verlauf (4 Zeiträume seit Planer „Steuern“) |
| | Haben übernommene Vorschläge gewirkt? | „Haben frühere Vorschläge geholfen?“ (Wirkungsbericht) |
| | Ist das Ziel richtig? | ggf. Ziel anpassen |

Bleibt eine Antwort zweimal „nein“, wird die Seite geändert oder ein Teil entfernt – nicht mehr Zahlen dazu.

Prüfabfrage:
```sql
select jsonb_pretty(optimierung_woche());             -- letzte 7 Tage
select status, count(*) from ki_vorschlaege where created_at > now() - interval '14 days' and art <> 'info' group by 1;
```

---

## 4. Dateien

- `supabase/SQL/44_optimierung_woche.sql` – Funktion `optimierung_woche(p_bis, p_tage)`, Einstellung `optimierung_ziel` (am 15.11.2026 ausgeführt)
- `supabase/functions/ki-tagesanalyse/index.ts` – Regel 4, Wirkung mit kWh je Heizgradtag
- `src/components/ki/OptimierungView.tsx` – die Anzeige
- `src/components/ki/AutoSteuerung.tsx` – Abschnitt 1, übrige Abschnitte jetzt 2–4
