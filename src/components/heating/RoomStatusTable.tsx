import { useState, useEffect } from 'react';
import { Room, getEffectiveHeatingPower } from '@/types/room';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, X, Thermometer, ChevronDown, ChevronRight, Moon, Zap, Sun, Clock, Info, AlertTriangle, RefreshCw, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { useActiveHeatingRooms } from '@/hooks/useActiveHeatingRooms';
import { useParallelHeatingCapacity } from '@/hooks/useParallelHeatingCapacity';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { usePushAllTemps } from '@/hooks/usePushAllTemps';

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

const getHeatingStatus = (
  room: Room,
  isActivelyHeating: boolean,
  livePower: number,
  isActivated: boolean,
  activationReason: 'plan' | 'setpoint' | 'queue' | undefined,
  modeLabel: string | undefined,
): { label: string; dotClass: string; badgeClass: string; icon?: typeof Clock; tooltip?: string } => {
  if (isActivelyHeating) {
    const label = livePower > 0 ? `Heizt · ${Math.round(livePower)}W` : 'Heizt';
    return { label, dotClass: 'bg-destructive', badgeClass: 'bg-destructive/10 text-destructive' };
  }
  if (isActivated) {
    const reasonLabel = activationReason === 'plan' ? 'Plan' : activationReason === 'queue' ? 'Queue' : 'Setpoint';
    const label = modeLabel ? `${modeLabel} gesetzt` : 'Aktiviert';
    return {
      label,
      dotClass: 'bg-blue-500',
      badgeClass: 'bg-blue-500/10 text-blue-600',
      icon: Flame,
      tooltip: `Automatik hat den Raum auf ${modeLabel ?? 'Heizen'} gesetzt (Quelle: ${reasonLabel}). Befehl an Thermostat gesendet — wartet auf Heiz-Bestätigung.`,
    };
  }
  // "Wartend": automation aktiv, Raum nicht aktiv heizend, aber deutlich unter Ziel
  if (
    room.automation_enabled &&
    room.target_temp != null &&
    room.current_temp != null &&
    room.target_temp - room.current_temp > 0.4
  ) {
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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const isMobile = useIsMobile();
  const { activeRooms, totalHeatingPower, sourceLevel, lastSyncAgeSec, activatedRoomIds, activationReasons, refetch: refetchActive } = useActiveHeatingRooms();
  const { pushAllTemps, isPushing } = usePushAllTemps();

  const handleSyncNow = async () => {
    const result = await pushAllTemps();
    if (result?.success) setTimeout(refetchActive, 3000);
  };

  const formatSyncAge = (sec: number | null) => {
    if (sec === null) return '—';
    if (sec < 60) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min`;
    return `${Math.round(min / 60)} h`;
  };
  const { data: capacity, updatedAt: capacityUpdatedAt } = useParallelHeatingCapacity();
  const { settings: heatingSettings } = useHeatingSettings();

  // Wien-Zeit "HH:MM"
  const getWienHHMM = (): string => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const h = parts.find(p => p.type === 'hour')?.value ?? '00';
    const m = parts.find(p => p.type === 'minute')?.value ?? '00';
    return `${h}:${m}`;
  };
  const isInNightWindow = (): boolean => {
    const start = (heatingSettings?.night_start_time || '22:00').substring(0, 5);
    const end = (heatingSettings?.night_end_time || '08:00').substring(0, 5);
    const now = getWienHHMM();
    // Über-Mitternacht-Fenster (z. B. 22:00 → 08:00)
    if (start > end) return now >= start || now < end;
    return now >= start && now < end;
  };
  const isCapacityFresh = (): boolean => {
    if (!capacityUpdatedAt) return false;
    const age = Date.now() - new Date(capacityUpdatedAt).getTime();
    return age < 10 * 60 * 1000; // 10 min
  };
  const showCapacityBadge = !!capacity
    && isCapacityFresh()
    && !isInNightWindow()
    && capacity.budget_mode !== 'night';

  // Map: room_id → live power (Watt) für aktiv heizende Räume
  const activePowerById = new Map(activeRooms.map(r => [r.room_id, r.power]));
  const activeRoomIds = new Set(activeRooms.map(r => r.room_id));

  const isRoomActivelyHeating = (room: Room) => activeRoomIds.has(room.id);
  const getRoomLivePower = (room: Room) => {
    if (!isRoomActivelyHeating(room)) return 0;
    const fromHook = activePowerById.get(room.id);
    if (fromHook && fromHook > 0) return fromHook;
    return getEffectiveHeatingPower(room);
  };

  // "Aktualisiert vor X s" Anzeige (Hook pollt alle 30s)
  useEffect(() => {
    setSecondsAgo(0);
    const interval = setInterval(() => setSecondsAgo(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [activeRooms]);

  const toggleRow = (roomId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };
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
            {/* Stale-Banner ("Heizstatus veraltet") und Stufe-B-Info-Banner entfernt — auf Wunsch des Nutzers */}
            {(activeRooms.length > 0 || activatedRoomIds.size > 0 || (showCapacityBadge && capacity!.comfort_budget_w > 500)) && (
              <div className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/20 flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 flex-wrap">
                  {activeRooms.length > 0 ? (
                    <>
                      Heizen: <strong className="text-foreground">{activeRooms.length}</strong>
                      {totalHeatingPower > 0 && <> · <strong className="text-foreground">{Math.round(totalHeatingPower).toLocaleString('de-DE')} W</strong></>}
                    </>
                  ) : (
                    <>Aktuell heizt kein Raum</>
                  )}
                  {activatedRoomIds.size > 0 && (
                    <> · <span className="text-blue-600">Aktiviert: <strong>{activatedRoomIds.size}</strong></span></>
                  )}
                  {showCapacityBadge && capacity && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            title="Parallele Kapazität"
                          >
                            <Info className="w-3 h-3" />
                            {capacity.max_parallel_comfort > 0 && (
                              <span>+{capacity.max_parallel_comfort} Komfort möglich</span>
                            )}
                            {capacity.max_parallel_comfort === 0 && capacity.max_parallel_eco > 0 && (
                              <span>+{capacity.max_parallel_eco} Eco möglich</span>
                            )}
                            {capacity.max_parallel_comfort === 0 && capacity.max_parallel_eco === 0 && (
                              <span>Budget knapp</span>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs">
                          <div className="space-y-1.5">
                            <div className="font-semibold border-b pb-1">Parallele Heiz-Kapazität</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                              <span className="text-muted-foreground">Komfort-Budget:</span>
                              <span className="font-mono text-right">{(capacity.comfort_budget_w / 1000).toFixed(2)} kW</span>
                              <span className="text-muted-foreground">→ parallele Räume:</span>
                              <span className="font-mono text-right">{capacity.max_parallel_comfort} / {capacity.comfort_candidates.length}</span>
                              <span className="text-muted-foreground">Eco-Budget:</span>
                              <span className="font-mono text-right">{(capacity.eco_budget_w / 1000).toFixed(2)} kW</span>
                              <span className="text-muted-foreground">→ parallele Räume:</span>
                              <span className="font-mono text-right">{capacity.max_parallel_eco} / {capacity.eco_candidates.length}</span>
                            </div>
                            <div className="border-t pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                              <span className="text-muted-foreground">Gridexport:</span>
                              <span className="font-mono text-right">{(capacity.grid_export_w / 1000).toFixed(2)} kW</span>
                              <span className="text-muted-foreground">Baseload-Puffer:</span>
                              <span className="font-mono text-right">−{capacity.baseload_buffer_w} W</span>
                              <span className="text-muted-foreground">PV-Trend (5 min):</span>
                              <span className="font-mono text-right">{capacity.trend_w_per_5min >= 0 ? '+' : ''}{capacity.trend_w_per_5min} W</span>
                              <span className="text-muted-foreground">Trend-Bonus:</span>
                              <span className="font-mono text-right">{capacity.trend_bonus_w >= 0 ? '+' : ''}{capacity.trend_bonus_w} W</span>
                              <span className="text-muted-foreground">Lookahead Stunde+1:</span>
                              <span className="font-mono text-right">{(capacity.next_hour_forecast_w / 1000).toFixed(1)} kW</span>
                              <span className="text-muted-foreground">Lookahead-Bonus:</span>
                              <span className="font-mono text-right">+{capacity.lookahead_bonus_w} W</span>
                            </div>
                            {capacity.lookahead_factor === 'cloud_warning' && (
                              <div className="text-amber-600 dark:text-amber-400 text-[11px] pt-1">⛅ Wolkenfront — Komfort gedrosselt</div>
                            )}
                            {capacity.planned_comfort_room_ids.length > 0 && (
                              <div className="border-t pt-1 text-[11px]">
                                <span className="text-muted-foreground">Geplant Komfort: </span>
                                <span>{capacity.comfort_candidates.filter(c => capacity.planned_comfort_room_ids.includes(c.room_id)).map(c => c.name).join(', ')}</span>
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); refetchActive(); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="Live-Status neu laden"
                >
                  Aktualisiert vor {secondsAgo}s
                </button>
              </div>
            )}
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
                            const livePower = getRoomLivePower(room);
                            const isActivated = activatedRoomIds.has(room.id);
                            const status = getHeatingStatus(room, isRoomActivelyHeating(room), livePower, isActivated, activationReasons.get(room.id), mode?.label);
                            const StatusIcon = status.icon;
                            return (
                              <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${status.badgeClass}`} title={status.tooltip}>
                                {StatusIcon ? <StatusIcon className="w-3 h-3" /> : <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />}
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
                      <TableHead className="text-xs w-6"></TableHead>
                      <TableHead className="text-xs">Raum</TableHead>
                      <TableHead className="text-xs w-16">Prio</TableHead>
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
                      const isExpanded = expandedRows.has(room.id);
                      return (
                        <>
                          <TableRow key={`${room.id}-${room.priority}`} className="cursor-pointer" onClick={() => toggleRow(room.id)}>
                            <TableCell className="px-1">
                              {isExpanded 
                                ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> 
                                : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                            </TableCell>
                            <TableCell className="text-xs font-medium">{room.name}</TableCell>
                            <TableCell onClick={e => e.stopPropagation()}>
                              <Input
                                type="number"
                                min={1}
                                max={12}
                                defaultValue={room.priority ?? 5}
                                className="w-14 h-7 text-xs px-1 text-center"
                                onBlur={e => room.id && handlePriorityChange(room.id, e.target.value, room.priority ?? 5)}
                              />
                            </TableCell>
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
                                const livePower = getRoomLivePower(room);
                                const isActivated = activatedRoomIds.has(room.id);
                                const status = getHeatingStatus(room, isRoomActivelyHeating(room), livePower, isActivated, activationReasons.get(room.id), mode?.label);
                                const StatusIcon = status.icon;
                                return (
                                  <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full w-fit ${status.badgeClass}`} title={status.tooltip}>
                                    {StatusIcon ? <StatusIcon className="w-3 h-3" /> : <span className={`w-2 h-2 rounded-full ${status.dotClass}`} />}
                                    {status.label}
                                  </span>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              {room.manual_override_until && new Date(room.manual_override_until) > new Date() ? (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-medium" title="Manuell gesteuert – Automation deaktiviert">
                                  Manuell
                                </span>
                              ) : room.automation_enabled ? (
                                <Check className="w-4 h-4 text-success" />
                              ) : (
                                <X className="w-4 h-4 text-destructive" />
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${room.id}-details`} className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={9} className="py-2 px-4">
                                <div className="flex items-center gap-6 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    Device ID: {room.tuya_device_id ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-destructive" />}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    Local Key: {room.local_key ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-destructive" />}
                                  </span>
                                  <span className="font-mono">
                                    IP: {room.thermostat_local_ip || '—'}
                                  </span>
                                  {room.heating_power_w && (
                                    <span>Leistung: {room.heating_power_w}W</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
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
