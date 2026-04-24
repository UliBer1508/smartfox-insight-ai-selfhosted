
## Ursache: Warum die Thermostate nicht zurückgestellt wurden

Die aktuelle Logik versucht im Nachtmodus zwar aktiv auf Frostschutz/Nacht zurückzustellen, aber sie scheitert in genau deinem Szenario an der Kanal-Logik:

1. In `supabase/functions/pv-automation/index.ts` wird im Nachtmodus für `frost_only` alle 30 Minuten ein Resync auf 5°C versucht.
2. Der eigentliche Schreibweg läuft über `setTemperatureForMode(...)`.
3. Sobald `quotaExhausted === true` und der Modus `cloud` ist, blockiert `setTemperatureForMode(...)` jeden Cloud-Call sofort mit `quota_exhausted`.
4. Der lokale Service ist aus, also gibt es keinen ausführenden Fallback für `thermostat_commands`.
5. Bei einem Nacht-Fehler schreibt der Code bewusst **keinen erfolgreichen Zielzustand** in die DB, damit kein falscher Erfolg angezeigt wird. Ergebnis: Das Thermostat bleibt physisch auf dem letzten echten Sollwert.

Kurz: Die Rückstellung wurde nicht ausgeführt, weil
- Cloud durch Quota gesperrt war,
- Local nicht verfügbar war,
- und der Code absichtlich kein „virtuelles Zurückstellen“ in der DB vortäuscht.

## Was ich ändern werde

### 1) Nacht-/Stop-Befehle als eigene Prioritätsklasse behandeln
In `pv-automation/index.ts` trenne ich:
- Aufheiz-Befehle
- Absenk-/Stop-Befehle (`night`, `frost_only`, harte Sicherheits-Stopps)

Nur Aufheizen bleibt strikt am Quota-Gate hängen. Absenken/Stoppen bekommt einen eigenen kleinen Schutzpfad.

### 2) Reservierte Notfall-Calls wirklich für Frostschutz nutzen
Es gibt schon die Idee „2 Calls Reserve für Notfall-Frostschutz“, aber aktuell blockiert `setTemperatureForMode(...)` trotzdem global.  
Ich ändere das so, dass echte Rückstell-/Stop-Befehle diese Reserve nutzen dürfen, statt pauschal geblockt zu werden.

### 3) Wenn Cloud blockiert ist: Stop-Befehle trotzdem in die Queue schreiben
Auch wenn der Modus auf `cloud` steht, soll bei Nacht/Frostschutz oder Sicherheits-Stopp zusätzlich ein deduplizierter `thermostat_commands`-Eintrag erzeugt werden:
- damit nichts verloren geht,
- und der lokale Service die Befehle sofort übernehmen kann, sobald er wieder aktiv ist.

Wichtig: Das ist **kein automatischer Moduswechsel**, sondern nur ein persistenter Fallback-Puffer.

### 4) Nacht-Fehler klarer markieren
Wenn ein Nacht-Reset scheitert, wird die Ursache explizit gespeichert:
- `quota_exhausted`
- `no_control_channel`
- `night_frost_failed`

So ist im UI eindeutig sichtbar: „Nicht zurückgestellt, weil kein Steuerkanal verfügbar war“.

### 5) Banner/Fehlermeldung präzisieren
Der bestehende `ApiErrorBanner` sagt bereits, dass die Cloud-Quota erschöpft ist. Ich erweitere die Meldung sinngemäß um:
- Rückstellung auf Nacht/Frostschutz konnte nicht mehr zugestellt werden
- Gerät hält daher möglicherweise den letzten physischen Sollwert
- manueller Eingriff ist nötig, solange kein Steuerkanal verfügbar ist

## Konkrete Dateien

- `supabase/functions/pv-automation/index.ts`
  - Nachtmodus-Branch
  - `setTemperatureForMode(...)`
  - Notfall-/Stop-Entscheidungen
  - Queue-Fallback + Dedupe
- `src/components/heating/ApiErrorBanner.tsx`
  - präzisere Nutzerhinweise bei Quota + fehlendem Rückstellen
- `.lovable/SYSTEM_DOCUMENTATION.md`
  - Abschnitt Nachtbetrieb / Quota-Schutz aktualisieren
- `mem://integration/tuya/api-quota-management-v2`
  - Reserve-Calls explizit als Stop-/Frostschutz-Calls dokumentieren

## Erwartetes Verhalten nach der Anpassung

- Wenn Cloud-Quota knapp ist, werden normale Aufheiz-Befehle weiterhin gebremst.
- Nacht-/Frostschutz-Rückstellungen haben Vorrang.
- Wenn selbst das nicht mehr per Cloud geht, werden die Stop-Befehle zuverlässig in der Queue hinterlegt.
- Die App zeigt dann klar: Rückstellung war fachlich angefordert, konnte aber physisch nicht zugestellt werden.

## Technische Details

- Keine neue Datenbanktabelle nötig
- Keine Migration erforderlich
- Hauptänderung ist reine Logik in der `pv-automation`-Function
- Bestehende manuelle Cloud/Local-Umschaltung bleibt unverändert
