## Ziel
Zwei kleine Robustheits-Fixes:

1. `useEnergyCalculation.ts`: Tagesstart konsequent in **Europe/Vienna** statt Browser-Lokalzeit (verhindert 2h Vortags-Daten auf UTC-Hosts).
2. `pv-automation/index.ts` Mikro-Budget: Cooldown-Anker konzeptuell sauber — basiert immer auf einem **Beendigungszeitpunkt**, auch wenn `ended_at` fehlt.

## Datei 1: `src/hooks/useEnergyCalculation.ts`

Ersetze `getLocalMidnightISO()` (Zeile 27–31) durch eine Wien-basierte Variante:

- Wien-Datum `YYYY-MM-DD` via `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' })`.
- Wien-Offset (DST-aware, `+01:00` / `+02:00`) via `timeZoneName: 'shortOffset'`.
- Konstruiere `new Date('YYYY-MM-DDT00:00:00+0X:00').toISOString()` als sauberen UTC-Wert für die DB-Query.

Der bestehende Aufruf-Punkt `useMemo(() => getLocalMidnightISO(), [])` bleibt unverändert.

## Datei 2: `supabase/functions/pv-automation/index.ts` (~Zeile 2157–2162)

`cooldownAnchor` so härten, dass er nie der reine Aktivierungszeitpunkt ist:

```ts
const microValue = lastMicroSetting?.value as { ts?: string; ended?: boolean; ended_at?: string } | undefined;
// Wenn beendet → ended_at, sonst rechnerisches Ende = ts + microHeatDuration.
// Damit ist der Cooldown-Anker IMMER ein (echter oder erwarteter) Beendigungszeitpunkt.
let cooldownAnchor: string | undefined;
if (microValue?.ended && microValue.ended_at) {
  cooldownAnchor = microValue.ended_at;
} else if (microValue?.ts) {
  cooldownAnchor = new Date(new Date(microValue.ts).getTime() + microHeatDuration * 60000).toISOString();
}
const stillRunning = microValue?.ts && microValue?.ended !== true;
```

`stillRunning`-Gate bleibt als Doppel-Sicherung erhalten (verhindert Re-Aktivierung während laufender Heizphase).

## Nicht geändert
- Edge Function timezone-Helpers (bereits Wien).
- Alle anderen Zeitfunktionen.
