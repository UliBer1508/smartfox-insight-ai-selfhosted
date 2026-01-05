import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Home, Plus, Pencil, Trash2, Sun, Compass, RefreshCw, Thermometer } from 'lucide-react';
import { Room, OrientationType, ORIENTATION_LABELS } from '@/types/room';
import { useTuyaControl, TuyaDevice } from '@/hooks/useTuyaControl';
import { Badge } from '@/components/ui/badge';

interface RoomManagerProps {
  rooms: Room[];
  onSave: (room: Partial<Room>) => void;
  onDelete: (roomId: string) => void;
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
  pv_auto_enabled: false,
};

export function RoomManager({ rooms, onSave, onDelete, isLoading }: RoomManagerProps) {
  const [editingRoom, setEditingRoom] = useState<Partial<Room> | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { devices, isLoading: devicesLoading, fetchDevices } = useTuyaControl();

  useEffect(() => {
    if (isDialogOpen && devices.length === 0) {
      fetchDevices();
    }
  }, [isDialogOpen, devices.length, fetchDevices]);
  const handleSave = () => {
    if (editingRoom && editingRoom.name) {
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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Home className="h-5 w-5" />
          Räume & Thermostate
        </CardTitle>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={handleAdd}>
              <Plus className="h-4 w-4 mr-1" />
              Raum hinzufügen
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
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
                    <Label htmlFor="priority">Priorität</Label>
                    <Select
                      value={String(editingRoom.priority || 2)}
                      onValueChange={v => setEditingRoom({ ...editingRoom, priority: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Hoch (1)</SelectItem>
                        <SelectItem value="2">Mittel (2)</SelectItem>
                        <SelectItem value="3">Niedrig (3)</SelectItem>
                      </SelectContent>
                    </Select>
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
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="tuya_device">Tuya-Gerät</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={fetchDevices}
                        disabled={devicesLoading}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${devicesLoading ? 'animate-spin' : ''}`} />
                        Aktualisieren
                      </Button>
                    </div>
                    <Select
                      value={editingRoom.tuya_device_id || 'none'}
                      onValueChange={v => setEditingRoom({ 
                        ...editingRoom, 
                        tuya_device_id: v === 'none' ? null : v 
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Tuya-Gerät wählen..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Kein Gerät</SelectItem>
                        {devices.map((device) => (
                          <SelectItem key={device.id} value={device.id}>
                            {device.name} {device.online ? '🟢' : '🔴'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {devices.length === 0 && !devicesLoading && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Keine Geräte gefunden. Klicke auf "Aktualisieren".
                      </p>
                    )}
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
      </CardHeader>
      <CardContent>
        {rooms.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            Noch keine Räume angelegt. Füge Räume hinzu, um raumspezifische Empfehlungen zu erhalten.
          </p>
        ) : (
          <div className="space-y-2">
            {rooms.map(room => (
              <div
                key={room.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    {getOrientationIcon(room.orientation)}
                    {room.has_solar_gain && <Sun className="h-4 w-4 text-amber-400" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{room.name}</p>
                      {room.tuya_device_id && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Thermometer className="h-3 w-3" />
                          {room.current_temp ? `${room.current_temp}°C` : 'Tuya'}
                        </Badge>
                      )}
                      {room.pv_auto_enabled && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Sun className="h-3 w-3" />
                          PV-Auto
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {room.floor_area_m2 ? `${room.floor_area_m2}m² · ` : ''}
                      {room.comfort_temp}°C / {room.eco_temp}°C / {room.night_temp}°C
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground px-2 py-1 bg-background rounded">
                    P{room.priority}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(room)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => room.id && onDelete(room.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
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
