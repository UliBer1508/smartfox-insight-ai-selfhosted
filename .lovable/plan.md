
# Raum-Uebersicht aufklappbar machen

## Aenderung

Die `RoomStatusTable` wird mit dem vorhandenen `Collapsible`-Component von Radix UI umgebaut. Der Header mit "Raum-Uebersicht" wird zum klickbaren Trigger, und die Tabelle wird ein-/ausklappbar. Standardmaessig zugeklappt, um Platz zu sparen.

## Technische Umsetzung

### Datei: `src/components/heating/RoomStatusTable.tsx`

- Import von `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` aus `@/components/ui/collapsible`
- Import von `ChevronDown` Icon aus `lucide-react`
- `useState` fuer den offenen/geschlossenen Zustand (Standard: `false` = zugeklappt)
- Der `CardHeader` wird zum `CollapsibleTrigger` mit einem Chevron-Icon das sich bei Oeffnen dreht
- Der `CardContent` mit der Tabelle wird in `CollapsibleContent` gewrappt
- Chevron rotiert um 180 Grad wenn geoeffnet (via CSS class toggle)

### Keine weiteren Dateien betroffen
