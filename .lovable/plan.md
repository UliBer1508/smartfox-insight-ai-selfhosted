
# Thermostat-Empfehlungen fuer Mobile optimieren

## Problem

Die Empfehlungskarten verwenden ein horizontales `flex justify-between` Layout. Auf schmalen Bildschirmen werden die Zeitangaben (Badge "15 - 18") und die Temperatur aus dem sichtbaren Bereich geschoben. Der Reason-Text ist auf `max-w-[200px]` begrenzt und wird abgeschnitten.

## Loesung

Das Layout der einzelnen Raumkarten wird auf Mobile vertikal gestapelt statt horizontal nebeneinander.

## Aenderung in `src/components/heating/RoomRecommendations.tsx`

### Neues Karten-Layout pro Raum (Mobile-optimiert)

Vorher (horizontal, ueberlaeuft):
```text
[Icon] [Name + Reason]          [20°C] [15 - 18]
```

Nachher (gestapelt, passt immer):
```text
[Icon] [Name]              [20°C]
       [Reason-Text]     [15 - 18]
```

### Konkrete Aenderungen

1. Aeusserer Container: Von `flex items-center justify-between` zu `flex flex-col gap-1 p-3` auf Mobile
2. Erste Zeile: Icon + Raumname links, Temperatur rechts (kompakt)
3. Zweite Zeile: Reason-Text links (volle Breite, kein truncate-Limit), Zeit-Badge rechts
4. Temperatur: Von `text-2xl` auf `text-lg font-bold` (kompakter)
5. `max-w-[200px]` entfernen, stattdessen `line-clamp-2` fuer mehrzeiligen Text
6. CardHeader Titel: Kleinere Schrift auf Mobile (`text-base sm:text-2xl`)

### Legende

Die Legende am unteren Rand bleibt unveraendert - sie funktioniert bereits gut mit `flex-wrap`.

## Ergebnis

- Kein horizontaler Overflow mehr
- Zeitangaben und Temperatur sind immer sichtbar
- Reason-Text kann mehrzeilig angezeigt werden statt abgeschnitten
- Funktioniert auf allen Bildschirmgroessen
