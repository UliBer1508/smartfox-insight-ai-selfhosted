import { Room } from '@/types/room';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Thermometer, Check, X } from 'lucide-react';

interface ThermostatOverviewTableProps {
  rooms: Room[];
}

export const ThermostatOverviewTable = ({ rooms }: ThermostatOverviewTableProps) => {
  const thermostatRooms = rooms.filter(r => r.tuya_device_id);

  if (thermostatRooms.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-primary" />
          Thermostate
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 px-3 text-xs">Raum</TableHead>
              <TableHead className="h-8 px-3 text-xs text-right">Temp</TableHead>
              <TableHead className="h-8 px-3 text-xs text-right">Ziel</TableHead>
              <TableHead className="h-8 px-3 text-xs text-center">Heizung</TableHead>
              <TableHead className="h-8 px-3 text-xs text-center">Auto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {thermostatRooms.map((room) => (
              <TableRow key={room.id || room.name}>
                <TableCell className="py-1.5 px-3 text-xs font-medium">{room.name}</TableCell>
                <TableCell className="py-1.5 px-3 text-xs text-right font-mono">
                  {room.current_temp != null ? `${room.current_temp}°` : '–'}
                </TableCell>
                <TableCell className="py-1.5 px-3 text-xs text-right font-mono">
                  {room.target_temp != null ? `${room.target_temp}°` : '–'}
                </TableCell>
                <TableCell className="py-1.5 px-3 text-center">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full ${
                      room.is_heating ? 'bg-red-500' : 'bg-muted-foreground/30'
                    }`}
                  />
                </TableCell>
                <TableCell className="py-1.5 px-3 text-center">
                  {room.automation_enabled ? (
                    <Check className="w-3.5 h-3.5 text-green-500 mx-auto" />
                  ) : (
                    <X className="w-3.5 h-3.5 text-muted-foreground/50 mx-auto" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
