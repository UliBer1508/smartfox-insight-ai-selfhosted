import { Room } from '@/types/room';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, X, Thermometer } from 'lucide-react';

interface RoomStatusTableProps {
  rooms: Room[];
}

export const RoomStatusTable = ({ rooms }: RoomStatusTableProps) => {
  const tuyaRooms = rooms.filter(r => r.tuya_device_id);
  if (tuyaRooms.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-primary" />
          Raum-Übersicht
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Raum</TableHead>
                <TableHead className="text-xs">Device ID</TableHead>
                <TableHead className="text-xs">Local Key</TableHead>
                <TableHead className="text-xs">Local IP</TableHead>
                <TableHead className="text-xs">Temp</TableHead>
                <TableHead className="text-xs">Ziel</TableHead>
                <TableHead className="text-xs">Heizung</TableHead>
                <TableHead className="text-xs">Auto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tuyaRooms.map(room => (
                <TableRow key={room.id}>
                  <TableCell className="text-xs font-medium">{room.name}</TableCell>
                  <TableCell>{room.tuya_device_id ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                  <TableCell>{room.local_key ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                  <TableCell className="text-xs font-mono">{room.thermostat_local_ip || '-'}</TableCell>
                  <TableCell className="text-xs">{room.current_temp != null ? `${room.current_temp}°` : '-'}</TableCell>
                  <TableCell className="text-xs">{room.target_temp != null ? `${room.target_temp}°` : '-'}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-xs">
                      <span className={`w-2 h-2 rounded-full ${room.is_heating ? 'bg-red-500' : 'bg-muted-foreground/30'}`} />
                      {room.is_heating ? 'An' : 'Aus'}
                    </span>
                  </TableCell>
                  <TableCell>{room.automation_enabled ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
