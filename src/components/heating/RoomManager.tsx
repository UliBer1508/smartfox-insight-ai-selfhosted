import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Home, Plus, Pencil, Trash2, Sun, Compass, Thermometer, TrendingUp, BarChart3, Loader2, Info, Leaf, Moon, ChevronDown, Zap } from 'lucide-react';
import { Room, OrientationType, ORIENTATION_LABELS, getEffectiveHeatingPower } from '@/types/room';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSolarGainAnalysis } from '@/hooks/useSolarGainAnalysis';
import { toast } from 'sonner';

interface RoomManagerProps {
  rooms: Room[];
  onSave: (room: Partial<Room>) => void;
  onDelete: (roomId: string) => void;
  onRoomsUpdated?: () => void;
  isLoading?: boolean;
}

const defaultRoom: Partial<Room> = {
  name: '',
  thermostat_type: 'TGP508',
  orientation: null,
  has_solar_gain: false,
  floor_area_m2: null,
  comfort_temp: 21,
  eco_temp: 19,
  night_temp: 17,
  priority: 2,
  heating_power_w: null,
  tuya_device_id: null,
  thermostat_ip: null,
  local_key: null,
  pv_auto_enabled: false,
};

export function RoomManager({ rooms, onSave, onDelete, onRoomsUpdated, isLoading }: RoomManagerProps) {
  const [editingRoom, setEditingRoom] = useState<Partial<Room> | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { isAnalyzing, runAnalysis } = useSolarGainAnalysis();

  const handleAnalyzeSolarGain = async () => {
    await runAnalysis();
    onRoomsUpdated?.();
  };
  const handleSave = () => {
    if (editingRoom && editingRoom.name) {
      // Duplikat-Prüfung für Priorität
      const conflict = rooms.find(r => r.priority === editingRoom.priority && r.id !== editingRoom.id);
      if (conflict) {
        toast.error(`Priorität ${editingRoom.priority} ist bereits an "${conflict.name}" vergeben`);
        return;
      }
      onSave(editingRoom);
      setIsDialogOpen(false);
      setEditingRoom(null);
    }
  };

  const handleEdit = (room: Room) => {
    setEditingRoom({ ...room });
    setIsDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingRoom({ ...defaultRoom });
    setIsDialogOpen(true);
  };

  const getOrientationIcon = (orientation?: OrientationType | null) => {
    if (!orientation) return null;
    const colors: Record<OrientationType, string> = {
      'süd': 'text-amber-500',
      'ost': 'text-orange-400',
      'west': 'text-orange-400',
      'nord': 'text-blue-400'
    };
    return <Compass className={`h-4 w-4 ${colors[orientation]}`} />;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Home className="h-5 w-5" />
          Räume & Thermostate
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleAnalyzeSolarGain}
            disabled={isAnalyzing || rooms.length === 0}
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <BarChart3 className="h-4 w-4 mr-1" />
            )}
            <span className="hidden sm:inline">Solar-Analyse</span>
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={handleAdd}>
                <Plus className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Raum hinzufügen</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingRoom?.id ? 'Raum bearbeiten' : 'Neuer Raum'}
              </DialogTitle>
            </DialogHeader>
            {editingRoom && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={editingRoom.name || ''}
                      onChange={e => setEditingRoom({ ...editingRoom, name: e.target.value })}
                      placeholder="z.B. Wohnzimmer"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="orientation">Ausrichtung</Label>
                    <Select
                      value={editingRoom.orientation || 'none'}
                      onValueChange={v => setEditingRoom({ 
                        ...editingRoom, 
                        orientation: v === 'none' ? null : v as OrientationType 
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Wählen..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Keine Angabe</SelectItem>
                        {Object.entries(ORIENTATION_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="area">Fläche (m²)</Label>
                    <Input
                      id="area"
                      type="number"
                      value={editingRoom.floor_area_m2 || ''}
                      onChange={e => setEditingRoom({ 
                        ...editingRoom, 
                        floor_area_m2: e.target.value ? parseFloat(e.target.value) : null 
                      })}
                      placeholder="z.B. 25"
                    />
                  </div>

                  <div>
                    <Label htmlFor="priority">Heiz-Priorität (1–12)</Label>
                    <Input
                      id="priority"
                      type="number"
                      min={1}
                      max={12}
                      value={editingRoom.priority ?? 5}
                      onChange={e => setEditingRoom({ 
                        ...editingRoom, 
                        priority: Math.max(1, Math.min(12, parseInt(e.target.value) || 1))
                      })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      1 = höchste Priorität beim sequenziellen Heizen
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="heating_power">Heizleistung (W)</Label>
                    <Input
                      id="heating_power"
                      type="number"
                      value={editingRoom.heating_power_w || ''}
                      onChange={e => setEditingRoom({ 
                        ...editingRoom, 
                        heating_power_w: e.target.value ? parseInt(e.target.value) : null 
                      })}
                      placeholder="z.B. 800"
                    />
                  </div>

                  <div>
                    <Label htmlFor="thermostat">Thermostat-Typ</Label>
                    <Input
                      id="thermostat"
                      value={editingRoom.thermostat_type || 'TGP508'}
                      onChange={e => setEditingRoom({ ...editingRoom, thermostat_type: e.target.value })}
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="thermostat_ip">Thermostat IP-Adresse</Label>
                    <Input
                      id="thermostat_ip"
                      value={editingRoom.thermostat_ip || ''}
                      onChange={e => setEditingRoom({ ...editingRoom, thermostat_ip: e.target.value || null })}
                      placeholder="z.B. 192.168.188.168"
                    />
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="tuya_device">Tuya Device ID</Label>
                    <Input
                      id="tuya_device"
                      value={editingRoom.tuya_device_id || ''}
                      onChange={e => setEditingRoom({ 
                        ...editingRoom, 
                        tuya_device_id: e.target.value || null 
                      })}
                      placeholder="z.B. bf2f469ec7aa367dbeeni9"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Device ID aus der Tuya IoT Platform
                    </p>
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="local_key">Local Key</Label>
                    <Input
                      id="local_key"
                      value={editingRoom.local_key || ''}
                      onChange={e => setEditingRoom({ 
                        ...editingRoom, 
                        local_key: e.target.value || null 
                      })}
                      placeholder="16-Zeichen Key aus API Explorer"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Aus Tuya IoT → Cloud → API Explorer → Query Device Details
                    </p>
                  </div>

                  <div className="col-span-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sun className="h-4 w-4 text-yellow-500" />
                      <Label htmlFor="pv_auto">PV-Überschuss Automatik</Label>
                    </div>
                    <Switch
                      id="pv_auto"
                      checked={editingRoom.pv_auto_enabled || false}
                      onCheckedChange={v => setEditingRoom({ ...editingRoom, pv_auto_enabled: v })}
                    />
                  </div>

                  <div className="col-span-2 flex items-center justify-between">
                    <Label htmlFor="solar">Direkter Sonneneinstrahlung</Label>
                    <Switch
                      id="solar"
                      checked={editingRoom.has_solar_gain || false}
                      onCheckedChange={v => setEditingRoom({ ...editingRoom, has_solar_gain: v })}
                    />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3">Temperaturen</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="comfort">Komfort °C</Label>
                      <Input
                        id="comfort"
                        type="number"
                        step="0.5"
                        value={editingRoom.comfort_temp || 21}
                        onChange={e => setEditingRoom({ 
                          ...editingRoom, 
                          comfort_temp: parseFloat(e.target.value) 
                        })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="eco">Eco °C</Label>
                      <Input
                        id="eco"
                        type="number"
                        step="0.5"
                        value={editingRoom.eco_temp || 19}
                        onChange={e => setEditingRoom({ 
                          ...editingRoom, 
                          eco_temp: parseFloat(e.target.value) 
                        })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="night">Nacht °C</Label>
                      <Input
                        id="night"
                        type="number"
                        step="0.5"
                        value={editingRoom.night_temp || 17}
                        onChange={e => setEditingRoom({ 
                          ...editingRoom, 
                          night_temp: parseFloat(e.target.value) 
                        })}
                      />
                    </div>
                  </div>

                  {/* PV-Boost Max-Temperatur */}
                  {editingRoom.pv_auto_enabled && (
                    <div className="mt-3 p-3 bg-primary/10 rounded-lg border border-primary/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-4 w-4 text-primary" />
                        <Label htmlFor="pv_boost_max">PV-Boost Max °C</Label>
                      </div>
                      <Input
                        id="pv_boost_max"
                        type="number"
                        step="0.5"
                        value={editingRoom.pv_boost_max_temp ?? ''}
                        onChange={e => setEditingRoom({ 
                          ...editingRoom, 
                          pv_boost_max_temp: e.target.value ? parseFloat(e.target.value) : null 
                        })}
                        placeholder={`Standard: Komfort + Delta`}
                        className="max-w-32"
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Maximale Temperatur bei PV-Überschuss. Leer = Komfort + globaler Boost-Delta.
                      </p>
                    </div>
                  )}
                  
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Abbrechen
                  </Button>
                  <Button onClick={handleSave} disabled={!editingRoom.name || isLoading}>
                    Speichern
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Temperatur-Modi Legende */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
            <Info className="h-4 w-4" />
            <span>Wann wird welche Temperatur verwendet?</span>
            <ChevronDown className="h-4 w-4 ml-auto transition-transform [[data-state=open]>&]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 p-3 bg-muted/30 rounded-lg text-sm space-y-2">
            <div className="flex items-start gap-2">
              <Sun className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <span><strong>Komfort:</strong> Bei PV-Überschuss tagsüber (Schwellwert aus Einstellungen)</span>
            </div>
            <div className="flex items-start gap-2">
              <Leaf className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span><strong>Eco:</strong> Tagsüber ohne ausreichend PV-Überschuss oder bei niedriger Batterie</span>
            </div>
            <div className="flex items-start gap-2">
              <Moon className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <span><strong>Nacht:</strong> Während der Nachtzeit (konfigurierbar in Einstellungen)</span>
            </div>
            <p className="text-xs text-muted-foreground border-t border-border pt-2 mt-2">
              💡 Die Automatik greift nur bei aktivierter <strong>PV-Auto</strong> Option für den jeweiligen Raum.
            </p>
          </CollapsibleContent>
        </Collapsible>
        {rooms.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            Noch keine Räume angelegt. Füge Räume hinzu, um raumspezifische Empfehlungen zu erhalten.
          </p>
        ) : (
          <div className="space-y-1.5 sm:space-y-2">
            {rooms.map(room => (
              <div
                key={room.id}
                className="flex items-center justify-between p-2 sm:p-3 bg-muted/50 rounded-lg gap-2"
              >
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <div className="hidden sm:flex items-center gap-1 shrink-0">
                    {getOrientationIcon(room.orientation)}
                    {room.has_solar_gain && <Sun className="h-4 w-4 text-amber-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <span className="font-medium text-sm sm:text-base truncate">{room.name}</span>
                      {room.tuya_device_id && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 sm:px-2 sm:py-0.5 gap-0.5 shrink-0">
                          <Thermometer className="h-3 w-3 hidden sm:inline" />
                          {room.current_temp ? `${room.current_temp}°C` : 'Tuya'}
                        </Badge>
                      )}
                      {room.pv_auto_enabled && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 sm:px-2 sm:py-0.5 gap-0.5 shrink-0">
                          <Sun className="h-3 w-3 hidden sm:inline" />
                          <span className="sm:hidden">PV</span>
                          <span className="hidden sm:inline">PV-Auto</span>
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="hidden sm:inline">
                        {room.floor_area_m2 ? `${room.floor_area_m2}m² · ` : ''}
                        {room.calculated_power_w && room.power_calculation_confidence ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-0.5 cursor-help">
                                  <TrendingUp className="h-3 w-3 text-green-500" />
                                  {room.calculated_power_w}W
                                  <span className="text-muted-foreground/60">
                                    ({Math.round(room.power_calculation_confidence * 100)}%)
                                  </span>
                                  {' · '}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  Berechnet aus {room.power_samples} Heizzyklen
                                  {room.heating_power_w && (
                                    <span className="block text-muted-foreground">
                                      Geschätzt: {room.heating_power_w}W
                                    </span>
                                  )}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : room.heating_power_w ? (
                          `${room.heating_power_w}W · `
                        ) : null}
                        {room.calculated_solar_gain_factor && room.solar_gain_confidence && room.solar_gain_confidence >= 0.3 ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-0.5 cursor-help text-amber-500">
                                  <Sun className="h-3 w-3" />
                                  {room.calculated_solar_gain_factor > 0 ? '+' : ''}{(room.calculated_solar_gain_factor * 5).toFixed(1)}°C/h
                                  {' · '}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  Solargewinn bei 5kW PV
                                  <span className="block text-muted-foreground">
                                    Konfidenz: {Math.round(room.solar_gain_confidence * 100)}% ({room.solar_gain_samples} Samples)
                                  </span>
                                  {room.calculated_heat_loss_rate && (
                                    <span className="block text-blue-400">
                                      Wärmeverlust: {room.calculated_heat_loss_rate.toFixed(2)}°C/h
                                    </span>
                                  )}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : null}
                      </span>
                      {room.comfort_temp}/{room.eco_temp}/{room.night_temp}°C
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-background rounded">
                    P{room.priority}
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={() => handleEdit(room)}>
                    <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    className="h-7 w-7 sm:h-8 sm:w-8"
                    onClick={() => room.id && onDelete(room.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
