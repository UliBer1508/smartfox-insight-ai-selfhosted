# Konzept: Haiku prüft mit (26.11.2026)

**Status:** von Uli freigegeben (26.11.2026) · umgesetzt in diesem PR, Start mit Schalter **AUS**
**Baut auf:** `KONZEPT-KI-VORSCHLAEGE-2026-11-02.md` (Prüfmodell, Whitelist, KI › Zu entscheiden),
`OPTIMIERUNG-UEBERSICHT-2026-11-15.md` (kWh je Heizgradtag, Wirkungsbericht)

---

## 1. Worum es geht

Die feste Regel-Steuerung und der Planer laufen weiter und machen ihren Job. `ki-tagesanalyse` prüft jeden Morgen
um 10:00 den Vortag – aber nur mit fünf fest programmierten Regeln. Muster außerhalb dieser Regeln findet sie nicht.

Neu: **Haiku** (Sprach-KI von Anthropic, `claude-haiku-5-5`) liest am Ende derselben Tagesanalyse mit und beantwortet
eine Frage: **Was erklären die Regeln nicht?** (z. B. Hochnebeltage, ein Raum kühlt schneller aus als die anderen,
Prognosefehler zu bestimmten Uhrzeiten, eine Änderung hat nicht gewirkt).

Uli (26.11.2026): Haiku läuft als Verbesserer von KI und Planer nebenher, einmal am Tag, und muss an- und
ausschaltbar sein – um zu sehen, ob es etwas bringt. Irgendwann ist das System nahe am Optimum; dann wird Haiku
ausgeschaltet oder nur noch als Wächter genutzt.

Zur Entscheidung vom 13.11.2026 („Sprach-KI entfernen“): Haiku steuert nichts, liest nur und schlägt vor.
Uli: einverstanden, die Sprach-KI kann später eventuell zusätzlich genutzt werden.

## 2. Was Haiku darf – und was nicht

| darf | darf nicht |
|---|---|
| bis zu **2 Hinweise** je Tag (Zur Info, Kennzeichen „Haiku:“) | etwas selbst ändern |
| bis zu **1 Vorschlag** je Tag, nur Werte der Whitelist mit Stufe `suggest`: `wait_min_temp` (Min je Raum, Normal − 2 … Normal), `max_grid_heating_power_w`, `heating_power_w` | Werte außerhalb der Whitelist oder ihrer Grenzen |
| melden, dass kaum noch Verbesserung kommt („Plateau“) | gegen die Grundsätze vorschlagen (nachts nur Min, Estrich mit PV, Batterie für die Nacht) |

Jeder Haiku-Vorschlag wird im Code geprüft wie die Regel-Vorschläge: Wert begrenzt und gerundet, mindestens 3 Tage
Basis, gesperrt wenn derselbe Wert offen oder in den letzten 7 Tagen abgelehnt ist, verworfen wenn die Regeln
denselben Wert schon vorschlagen. Uli genehmigt wie gewohnt unter **KI › Zu entscheiden** (Kennzeichen „Haiku“).
Der **Wirkungsbericht** (3 Tage danach, kWh je Heizgradtag) läuft für Haiku-Vorschläge automatisch mit.

## 3. Ablauf

1. 10:00 `analysis-scheduler` → `ki-tagesanalyse`
2. Regeln 1, 2, 4, 5, Nacht-Kontrolle, Wirkungsberichte – wie bisher, Ergebnisse werden geschrieben
3. **Neu:** ist `system_settings.ki_haiku.aktiv = true`, bekommt Haiku die Daten (7 Tage je Raum, 7 Nächte je Raum,
   Raumwerte, erlaubte Werte, was die Regeln heute melden, Wirkung der letzten 20 Entscheidungen, eigene frühere
   Befunde) und antwortet über ein festes Schema (Tool `bericht`)
4. Prüfung, Schreiben nach `ki_vorschlaege` (`quelle = 'haiku'`), eine Zeile in `ki_haiku_lauf`
5. Rückblick (`ki_tagespaket`) bekommt einen Satz „Haiku hat zusätzlich …“

Fehler von Haiku (kein Schlüssel, Zeitüberschreitung 60 s, API-Fehler) stoppen die Tagesanalyse **nicht** – sie
landen im Protokoll („Haiku-Prüfung fehlgeschlagen“) und in `ki_haiku_lauf.fehler`.

## 4. Bringt es etwas? – An/Aus und Bilanz

- Schalter **„Haiku prüft mit“** unten in KI › Zu entscheiden (schreibt `system_settings.ki_haiku`, Eintrag im Protokoll).
  Aus = Haiku wird nicht aufgerufen; Daten, Regeln, Planer laufen weiter – die Vergleichsbasis bleibt.
- Die Karte zeigt `ki_haiku_bilanz(28)`: Haiku gegen feste Regeln – vorgeschlagen, genehmigt, Wirkung
  besser/gleich/schlechter, Anzahl Hinweise, Läufe, Kosten.
- Maßstab bleibt wetterbereinigt: kWh je Heizgradtag, Sonnenstrom genutzt, Stunden unter Min („Wo stehen wir?“).

**Prüfplan:** nach 4 Wochen mit Haiku (Sonnen- und trübe Tage dabei):
| Frage | Woran |
|---|---|
| Findet Haiku etwas, was die Regeln nicht finden? | Hinweise, die Uli brauchbar findet |
| Helfen Haiku-Vorschläge? | genehmigt und Wirkung „besser“ (Bilanz) |
| Meldet Haiku Plateau? | `plateau_meldungen` – dann ausschalten oder nur wöchentlich als Wächter |

Bleibt es zweimal bei „nein“, wird Haiku ausgeschaltet.

## 5. Nebenwirkungen (geprüft 26.11.2026)

| Wer | Prüfung | Ergebnis |
|---|---|---|
| `ki_vorschlaege` | Spalten, Constraints, Trigger | `quelle` ist freier Text, kein Check, keine Trigger – keine Änderung nötig |
| Genehmigen (`useKiVorschlaege.genehmigen`) | Grenzen | prüft Whitelist und aktuelle Raumgrenzen selbst – Haiku kann nichts außerhalb schreiben |
| Sperre der Regeln | gleicher Wert + Raum offen | ein offener Haiku-Vorschlag sperrt die Regel für denselben Wert und umgekehrt – gewollt, keine Doppel-Vorschläge |
| Infos des Tages | `delete … art = 'info'` bei wiederholtem Lauf | Haiku schreibt danach im selben Lauf → bei Wiederholung neu erzeugt, keine Doppel-Hinweise |
| `analysis-scheduler` | Laufzeit | Haiku-Aufruf ca. 5–20 s, begrenzt auf 60 s; um 10:00 läuft nichts anderes im selben Slot |
| `ANTHROPIC_API_KEY` | wer nutzt ihn | keine andere Function (Gemini/Claude-Aufrufe am 13.11. entfernt) – Erneuern ohne Nebenwirkung |
| Kosten | ca. 10–15 Tsd. Tokens je Lauf | ca. 0,002 $ je Tag, unter 0,10 $ im Monat (Haiku 5.5: 0,10 $ / 0,50 $ je Mio. Tokens) |

## 6. Einschalten

1. In der Claude Console (console.anthropic.com) einen **neuen API-Schlüssel** erstellen, den alten löschen,
   ein **Monatslimit** setzen (z. B. 5 $).
2. Supabase › Edge Functions › Secrets: `ANTHROPIC_API_KEY` durch den neuen Schlüssel ersetzen
   (nicht in den Chat kopieren).
3. SQL `61_ki_haiku.sql` ausführen.
4. PR mergen (Edge Function wird per GitHub-Aktion deployt, Frontend per Vercel).
5. Test (nach dem Einschalten, Schritt 6): `analysis-scheduler?force=ki_tagesanalyse` aufrufen (oder bis 10:00 warten), danach `select * from ki_haiku_lauf order by tag desc limit 1;`
6. Schalter „Haiku prüft mit“ einschalten.

## 7. Dateien

- `supabase/SQL/61_ki_haiku.sql` – Schalter, Tabelle `ki_haiku_lauf`, Funktion `ki_haiku_bilanz`
- `supabase/functions/ki-tagesanalyse/haiku.ts` – Haiku-Prüfer (Daten, Prompt, Prüfung, Schreiben)
- `supabase/functions/ki-tagesanalyse/index.ts` – Aufruf nach den Regeln, Satz im Rückblick
- `src/components/ki/HaikuSchalter.tsx` – Schalter und Bilanz
- `src/components/ki/ZuEntscheiden.tsx`, `src/hooks/useKiVorschlaege.ts` – Kennzeichen „Haiku“
