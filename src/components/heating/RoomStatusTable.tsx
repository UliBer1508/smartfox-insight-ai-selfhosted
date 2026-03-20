import { useState } from 'react';
import { Room } from '@/types/room';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Check, X, Thermometer, ChevronDown } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface RoomStatusTableProps {
  rooms: Room[];
  onSavePriority?: (roomId: string, priority: number) => void;
}

export const RoomStatusTable = ({ rooms, onSavePriority }: RoomStatusTableProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();
  const tuyaRooms = rooms.filter(r => r.tuya_device_id).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  if (tuyaRooms.length === 0) return null;

  const handlePriorityChange = (roomId: string, value: string, currentPriority: number) => {
    const num = parseInt(value);
    if (!isNaN(num) && num >= 1 && num <= 12 && onSavePriority && num !== currentPriority) {
      onSavePriority(roomId, num);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-2 cursor-pointer select-none">
            <CardTitle className="text-sm flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-primary" />
              Raum-Übersicht
              <span className="text-xs font-normal text-muted-foreground ml-1">({tuyaRooms.length})</span>
              <ChevronDown className={`w-4 h-4 ml-auto transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-0">
            {isMobile ? (
              <div className="divide-y">
                {tuyaRooms.map(room => (
                  <div key={`${room.id}-${room.priority}`} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{room.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${
                          room.is_heating 
                            ? 'bg-destructive/10 text-destructive' 
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${room.is_heating ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
                          {room.is_heating ? 'Heizt' : 'Aus'}
                        </span>
                        {room.automation_enabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Auto</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        Prio:
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          defaultValue={room.priority ?? 5}
                          className="w-12 h-6 text-xs px-1 text-center text-foreground"
                          onBlur={e => room.id && handlePriorityChange(room.id, e.target.value, room.priority ?? 5)}
                        />
                      </span>
                      {room.current_temp != null && (
                        <span>Ist: <strong className="text-foreground">{room.current_temp}°</strong></span>
                      )}
                      {room.target_temp != null && (
                        <span>Ziel: <strong className="text-foreground">{room.target_temp}°</strong></span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        ID {room.tuya_device_id ? <Check className="w-3 h-3 text-success" /> : <X className="w-3 h-3 text-destructive" />}
                      </span>
                      <span className="flex items-center gap-1">
                        Key {room.local_key ? <Check className="w-3 h-3 text-success" /> : <X className="w-3 h-3 text-destructive" />}
                      </span>
                      {room.thermostat_local_ip && (
                        <span className="font-mono text-[10px]">{room.thermostat_local_ip}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Raum</TableHead>
                      <TableHead className="text-xs w-16">Prio</TableHead>
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
                      <TableRow key={`${room.id}-${room.priority}`}>
                        <TableCell className="text-xs font-medium">{room.name}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            max={12}
                            defaultValue={room.priority ?? 5}
                            className="w-14 h-7 text-xs px-1 text-center"
                            onBlur={e => room.id && handlePriorityChange(room.id, e.target.value)}
                          />
                        </TableCell>
                        <TableCell>{room.tuya_device_id ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                        <TableCell>{room.local_key ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                        <TableCell className="text-xs font-mono">{room.thermostat_local_ip || '-'}</TableCell>
                        <TableCell className="text-xs">{room.current_temp != null ? `${room.current_temp}°` : '-'}</TableCell>
                        <TableCell className="text-xs">{room.target_temp != null ? `${room.target_temp}°` : '-'}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1 text-xs">
                            <span className={`w-2 h-2 rounded-full ${room.is_heating ? 'bg-destructive' : 'bg-muted-foreground/30'}`} />
                            {room.is_heating ? 'An' : 'Aus'}
                          </span>
                        </TableCell>
                        <TableCell>{room.automation_enabled ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
