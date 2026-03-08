

# Warum wird vor 09:00 geheizt — obwohl Nachtende 09:00 ist

## Befund

Die `isNightTime`-Funktion in `pv-automation/index.ts` ist **korrekt implementiert**. Bei `night_end_time = '09:00'` gibt sie vor 09:00 `isNight = true` zurück, und der Nachtmodus setzt `nightTemp`. Der Code würde korrekt arbeiten.

**Das Problem ist ein anderes:** Die `pv-automation` Edge Function wird **nicht aufgerufen**. Die `last_auto_change`-Werte aller Räume sind vom 03.03. — 5 Tage alt. Das bedeutet:

- Die Thermostate (TGP508) laufen seit 5 Tagen **autonom** mit ihrem internen Zeitprogramm
- Die TGP508 haben eigene eingebaute Heizperioden die um z.B. 06:00 oder 07:00 starten
- Kein externer Override wird gesendet, also heizen sie nach internem Plan

## Lösung

Die `pv-automation` Edge Function muss **regelmäßig getriggert** werden, damit sie die Thermostate überschreiben kann. Dafür gibt es zwei Optionen:

### Option A: pg_cron Job (empfohlen — kein Collector nötig)

Ein Datenbank-Cron-Job ruft die Edge Function alle 2 Minuten auf:

```sql
select cron.schedule(
  'pv-automation-check',
  '*/2 * * * *',
  $$
  select net.http_post(
    url:='https://tvqmhdpcixkfsudxughs.supabase.co/functions/v1/pv-automation',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer <anon_key>"}'::jsonb,
    body:='{"action": "check"}'::jsonb
  ) as request_id;
  $$
);
```

Voraussetzung: `pg_cron` und `pg_net` Extensions müssen aktiviert sein.

### Option B: Collector-Integration

In `local-collector/collector-node/index.js` einen HTTP-Call an die Edge Function nach jedem Poll hinzufügen. Nachteil: Funktioniert nur wenn der Collector läuft.

### Zusätzlich: Morgen-Aufwärmphase entfernen

Wie bereits besprochen — der Code-Block Zeilen 1093-1136 heizt nach Nachtende **immer sofort** auf `eco_temp`, auch ohne PV. Beide Branches (`canHeat: true` und `canHeat: false`) setzen identisch `targetTemp = ecoTemp`. Die `isOptimalHeatingTime`-Prüfung ist wirkungslos.

**Vorgeschlagene Änderung:** Block Zeilen 1093-1136 und Funktion `isOptimalHeatingTime` (Zeilen 98-159) entfernen. Die normale Tag-Logik (Grid-Fallback → eco, PV → comfort, Boost → boost_max) übernimmt automatisch.

## Zusammenfassung

| Was | Status |
|-----|--------|
| `isNightTime`-Logik | Korrekt — vor 09:00 = Nacht |
| Heizen vor 09:00 | TGP508 internes Programm, kein Override |
| Ursache | Edge Function wird nicht getriggert |
| Fix | pg_cron Job alle 2 Min oder Collector-Integration |
| Bonus | Morgen-Aufwärmphase entfernen (redundant) |

