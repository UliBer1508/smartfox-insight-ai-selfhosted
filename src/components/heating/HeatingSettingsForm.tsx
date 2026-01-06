import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { HeatingSettings } from '@/types/heating';
import { Settings, Save, MapPin, Zap, Thermometer, Car, Droplets } from 'lucide-react';

interface HeatingSettingsFormProps {
  settings: HeatingSettings;
  onSave: (settings: Partial<HeatingSettings>) => void;
  isLoading: boolean;
}

const AZIMUTH_OPTIONS = [
  { value: '0', label: 'Süd (0°)' },
  { value: '45', label: 'Südwest (45°)' },
  { value: '-45', label: 'Südost (-45°)' },
  { value: '90', label: 'West (90°)' },
  { value: '-90', label: 'Ost (-90°)' },
  { value: '135', label: 'Nordwest (135°)' },
  { value: '-135', label: 'Nordost (-135°)' },
  { value: '180', label: 'Nord (180°)' },
];

export function HeatingSettingsForm({ settings, onSave, isLoading }: HeatingSettingsFormProps) {
  const [formData, setFormData] = useState(settings);

  const handleChange = (field: keyof HeatingSettings, value: number | boolean | string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Anlagen-Konfiguration
        </CardTitle>
        <CardDescription>
          Einstellungen für PV-Anlage, Batterie, Temperaturen und Standort
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* PV & Battery */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pv_capacity">PV-Kapazität (kWp)</Label>
              <Input
                id="pv_capacity"
                type="number"
                step="0.1"
                value={formData.pv_capacity_kwp}
                onChange={(e) => handleChange('pv_capacity_kwp', parseFloat(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="battery_capacity">Batterie-Kapazität (kWh)</Label>
              <Input
                id="battery_capacity"
                type="number"
                step="0.1"
                value={formData.battery_capacity_kwh}
                onChange={(e) => handleChange('battery_capacity_kwh', parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Battery SOC Targets */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min_soc">Min. Batterie-SOC (%)</Label>
              <Input
                id="min_soc"
                type="number"
                min="0"
                max="100"
                value={formData.min_battery_soc}
                onChange={(e) => handleChange('min_battery_soc', parseInt(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Reserve für Notfälle</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="target_soc">Ziel Batterie-SOC (%)</Label>
              <Input
                id="target_soc"
                type="number"
                min="0"
                max="100"
                value={formData.target_battery_soc}
                onChange={(e) => handleChange('target_battery_soc', parseInt(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Ab hier Heizung nutzen</p>
            </div>
          </div>

          {/* Temperatures */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="comfort_temp">Komfort-Temp. (°C)</Label>
              <Input
                id="comfort_temp"
                type="number"
                step="0.5"
                value={formData.comfort_temp}
                onChange={(e) => handleChange('comfort_temp', parseFloat(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Bei PV-Überschuss</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="eco_temp">Eco-Temp. (°C)</Label>
              <Input
                id="eco_temp"
                type="number"
                step="0.5"
                value={formData.eco_temp}
                onChange={(e) => handleChange('eco_temp', parseFloat(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Normal-Betrieb</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="night_temp">Nacht-Temp. (°C)</Label>
              <Input
                id="night_temp"
                type="number"
                step="0.5"
                value={formData.night_temp}
                onChange={(e) => handleChange('night_temp', parseFloat(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Nachtabsenkung</p>
            </div>
          </div>

          {/* PV-Automatik Schwellwerte */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4" />
              PV-Automatik Schwellwerte
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="threshold_on">Heizen ab (W)</Label>
                <Input
                  id="threshold_on"
                  type="number"
                  min="0"
                  step="100"
                  value={formData.pv_surplus_threshold_on || 500}
                  onChange={(e) => handleChange('pv_surplus_threshold_on', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">PV-Überschuss für Aktivierung</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="threshold_off">Stoppen unter (W)</Label>
                <Input
                  id="threshold_off"
                  type="number"
                  min="0"
                  step="100"
                  value={formData.pv_surplus_threshold_off || 200}
                  onChange={(e) => handleChange('pv_surplus_threshold_off', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Hysterese-Schwelle</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="switch_interval">Schaltintervall (Min)</Label>
                <Input
                  id="switch_interval"
                  type="number"
                  min="1"
                  max="60"
                  value={formData.min_switch_interval_min || 5}
                  onChange={(e) => handleChange('min_switch_interval_min', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Mindestzeit zwischen Schaltvorgängen</p>
              </div>
            </div>
          </div>

          {/* Fußbodenheizung-Parameter */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Thermometer className="w-4 h-4" />
              Fußbodenheizung-Eigenschaften
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="response_hours">Reaktionszeit (Stunden)</Label>
                <Input
                  id="response_hours"
                  type="number"
                  min="0.5"
                  max="8"
                  step="0.5"
                  value={formData.floor_heating_response_hours || 2}
                  onChange={(e) => handleChange('floor_heating_response_hours', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Wie lange braucht die Heizung zum Aufheizen</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="estrich">Estrich als Wärmespeicher</Label>
                <div className="flex items-center space-x-2 pt-2">
                  <Switch
                    id="estrich"
                    checked={formData.estrich_storage_enabled ?? true}
                    onCheckedChange={(checked) => handleChange('estrich_storage_enabled', checked)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {formData.estrich_storage_enabled ? 'Aktiv - PV-Überschuss in Estrich speichern' : 'Deaktiviert'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Warmwasser-Bereitung */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Droplets className="w-4 h-4" />
              Warmwasser-Bereitung (Smartfox-gesteuert)
            </h3>
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="space-y-2">
                <Label htmlFor="hotwater_enabled">Warmwasser in Analyse berücksichtigen</Label>
                <div className="flex items-center space-x-2 pt-2">
                  <Switch
                    id="hotwater_enabled"
                    checked={formData.hotwater_enabled ?? true}
                    onCheckedChange={(checked) => handleChange('hotwater_enabled', checked)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {formData.hotwater_enabled !== false ? 'Aktiv' : 'Deaktiviert'}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="hotwater_power">Heizstab-Leistung (W)</Label>
                <Input
                  id="hotwater_power"
                  type="number"
                  min="0"
                  step="100"
                  value={formData.hotwater_power_w || 2800}
                  onChange={(e) => handleChange('hotwater_power_w', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Typisch: 2000-3000W</p>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hotwater_start">Schaltzeit Start</Label>
                <Input
                  id="hotwater_start"
                  type="time"
                  value={formData.hotwater_schedule_start || '10:00'}
                  onChange={(e) => handleChange('hotwater_schedule_start', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hotwater_end">Schaltzeit Ende</Label>
                <Input
                  id="hotwater_end"
                  type="time"
                  value={formData.hotwater_schedule_end || '16:00'}
                  onChange={(e) => handleChange('hotwater_schedule_end', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hotwater_surplus">Min. Überschuss (W)</Label>
                <Input
                  id="hotwater_surplus"
                  type="number"
                  min="0"
                  step="100"
                  value={formData.hotwater_min_surplus_w || 1000}
                  onChange={(e) => handleChange('hotwater_min_surplus_w', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Smartfox aktiviert ab diesem Überschuss</p>
              </div>
            </div>
          </div>

          {/* Verbraucher-Priorität */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <Car className="w-4 h-4" />
              Verbraucher-Priorität
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priority">Reihenfolge bei PV-Überschuss</Label>
                <Select
                  value={formData.consumer_priority || 'battery,hotwater,heating,car'}
                  onValueChange={(value) => handleChange('consumer_priority', value)}
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="battery,hotwater,heating,car">Batterie → Warmwasser → Heizung → E-Auto</SelectItem>
                    <SelectItem value="battery,heating,hotwater,car">Batterie → Heizung → Warmwasser → E-Auto</SelectItem>
                    <SelectItem value="hotwater,battery,heating,car">Warmwasser → Batterie → Heizung → E-Auto</SelectItem>
                    <SelectItem value="battery,heating,car">Batterie → Heizung → E-Auto (ohne Warmwasser)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Smartfox steuert Warmwasser + E-Auto automatisch</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="car_power">Min. Ladeleistung E-Auto (W)</Label>
                <Input
                  id="car_power"
                  type="number"
                  min="1380"
                  step="690"
                  value={formData.car_min_charge_power_w || 1380}
                  onChange={(e) => handleChange('car_min_charge_power_w', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">6A × 230V = 1380W (Mindestladestrom)</p>
              </div>
            </div>
          </div>

          {/* Location Settings for PV Forecast */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4" />
              Standort für PV-Prognose
            </h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="latitude">Breitengrad</Label>
                <Input
                  id="latitude"
                  type="number"
                  step="0.00001"
                  value={formData.latitude || 47.24983}
                  onChange={(e) => handleChange('latitude', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="longitude">Längengrad</Label>
                <Input
                  id="longitude"
                  type="number"
                  step="0.00001"
                  value={formData.longitude || 12.25415}
                  onChange={(e) => handleChange('longitude', parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azimuth">Ausrichtung</Label>
                <Select
                  value={String(formData.roof_azimuth || 0)}
                  onValueChange={(value) => handleChange('roof_azimuth', parseInt(value))}
                >
                  <SelectTrigger id="azimuth">
                    <SelectValue placeholder="Wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {AZIMUTH_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="declination">Neigung (°)</Label>
                <Input
                  id="declination"
                  type="number"
                  min="0"
                  max="90"
                  value={formData.roof_declination || 35}
                  onChange={(e) => handleChange('roof_declination', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">0° = flach, 90° = senkrecht</p>
              </div>
            </div>
          </div>

          <Button type="submit" disabled={isLoading}>
            <Save className="w-4 h-4 mr-2" />
            Speichern
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
