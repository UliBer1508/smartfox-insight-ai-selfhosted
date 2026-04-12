import { useState } from 'react';
import { Room } from '@/types/room';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Check, X, Thermometer, ChevronDown, Moon, Zap, Sun, Clock } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

interface RoomStatusTableProps {
  rooms: Room[];
  onSavePriority?: (roomId: string, priority: number) => void;
}

const getProgress = (room: Room) => {
  if (room.current_temp == null || room.target_temp == null) return null;
  const night = room.night_temp ?? 16;
  const range = room.target_temp - night;
  if (range <= 0) return { percent: 100, diff: 0 };
  const percent = Math.min(100, Math.max(0, ((room.current_temp - night) / range) * 100));
  const diff = Math.round((room.target_temp - room.current_temp) * 10) / 10;
  return { percent, diff };
};

const getProgressColor = (diff: number) => {
  if (diff <= 0.2) return 'bg-green-500';
  if (diff <= 1.0) return 'bg-orange-400';
  return 'bg-red-400';
};

const getHeatingStatus = (room: Room): { label: string; dotClass: string; badgeClass: string; icon?: typeof Clock } => {
  if (room.is_heating) {
    return { label: 'Heizt', dotClass: 'bg-destructive', badgeClass: 'bg-destructive/10 text-destructive' };
  }
  // "Wartend": target is set, current temp is below target (hysteresis zone)
  if (room.target_temp != null && room.current_temp != null && room.target_temp - room.current_temp > 0.3) {
    return { label: 'Wartend', dotClass: 'bg-orange-400 animate-pulse', badgeClass: 'bg-orange-400/10 text-orange-500', icon: Clock };
  }
  return { label: 'Aus', dotClass: 'bg-muted-foreground/40', badgeClass: 'bg-muted text-muted-foreground' };
};

const getHeatingMode = (room: Room) => {
  if (room.target_temp == null) return null;
  const night = room.night_temp ?? 16;
  const eco = room.eco_temp ?? 18;
  const comfort = room.comfort_temp ?? 21;

  if (room.target_temp <= night) return { label: 'Nacht', icon: Moon, color: 'bg-blue-500/10 text-blue-500' };
  if (room.target_temp <= eco) return { label: 'Eco', icon: Zap, color: 'bg-yellow-500/10 text-yellow-600' };
  if (room.target_temp >= comfort) return { label: 'Komfort', icon: Sun, color: 'bg-orange-500/10 text-orange-500' };
  return { label: 'Eco+', icon: Zap, color: 'bg-yellow-500/10 text-yellow-600' };
};

export const RoomStatusTable = ({ rooms, onSavePriority }: RoomStatusTableProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();
  const tuyaRooms = rooms.filter(r => r.tuya_device_id).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  if (tuyaRooms.length === 0) return null;

  const handlePriorityChange = (roomId: string, value: string, currentPriority: number) => {
    const num = parseInt(value);
    if (isNaN(num) || num < 1 || num > 12 || num === currentPriority) return;
    if (!onSavePriority) return;
    const conflict = tuyaRooms.find(r => r.priority === num && r.id !== roomId);
    if (conflict) {
      toast.error(`Priorität ${num} ist bereits an "${conflict.name}" vergeben`);
      return;
    }
    onSavePriority(roomId, num);
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
                {tuyaRooms.map(room => {
                  const mode = getHeatingMode(room);
                  return (
                    <div key={`${room.id}-${room.priority}`} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{room.name}</span>
                        <div className="flex items-center gap-2">
                          {mode && (
                            <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${mode.color}`}>
                              <mode.icon className="w-3 h-3" />
                              {mode.label}
                            </span>
                          )}
                          {(() => {
                            const status = getHeatingStatus(room);
                            return (
                              <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${status.badgeClass}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
                                {status.label}
                              </span>
                            );
                          })()}
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
                      {(() => {
                        const progress = getProgress(room);
                        if (!progress) return null;
                        return (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${getProgressColor(progress.diff)}`}
                                style={{ width: `${progress.percent}%` }}
                              />
                            </div>
                            <span className={`text-xs font-medium min-w-[3rem] text-right ${progress.diff <= 0.2 ? 'text-green-500' : 'text-muted-foreground'}`}>
                              {progress.diff <= 0.2 ? '✓' : `-${progress.diff}°`}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
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
                      <TableHead className="text-xs w-28">Fortschritt</TableHead>
                      <TableHead className="text-xs">Modus</TableHead>
                      <TableHead className="text-xs">Heizung</TableHead>
                      <TableHead className="text-xs">Auto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tuyaRooms.map(room => {
                      const mode = getHeatingMode(room);
                      return (
                        <TableRow key={`${room.id}-${room.priority}`}>
                          <TableCell className="text-xs font-medium">{room.name}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={1}
                              max={12}
                              defaultValue={room.priority ?? 5}
                              className="w-14 h-7 text-xs px-1 text-center"
                              onBlur={e => room.id && handlePriorityChange(room.id, e.target.value, room.priority ?? 5)}
                            />
                          </TableCell>
                          <TableCell>{room.tuya_device_id ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                          <TableCell>{room.local_key ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                          <TableCell className="text-xs font-mono">{room.thermostat_local_ip || '-'}</TableCell>
                          <TableCell className="text-xs">{room.current_temp != null ? `${room.current_temp}°` : '-'}</TableCell>
                          <TableCell className="text-xs">{room.target_temp != null ? `${room.target_temp}°` : '-'}</TableCell>
                          <TableCell>
                            {(() => {
                              const progress = getProgress(room);
                              if (!progress) return '—';
                              return (
                                <div className="flex items-center gap-1.5">
                                  <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${getProgressColor(progress.diff)}`}
                                      style={{ width: `${progress.percent}%` }}
                                    />
                                  </div>
                                  <span className={`text-[10px] font-medium ${progress.diff <= 0.2 ? 'text-green-500' : 'text-muted-foreground'}`}>
                                    {progress.diff <= 0.2 ? '✓' : `-${progress.diff}°`}
                                  </span>
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            {mode ? (
                              <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium w-fit ${mode.color}`}>
                                <mode.icon className="w-3 h-3" />
                                {mode.label}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const status = getHeatingStatus(room);
                              return (
                                <span className="flex items-center gap-1 text-xs">
                                  <span className={`w-2 h-2 rounded-full ${status.dotClass}`} />
                                  {status.label}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell>{room.automation_enabled ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-destructive" />}</TableCell>
                        </TableRow>
                      );
                    })}
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
