import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HeatingSettings } from '@/types/heating';
import { Settings, Save } from 'lucide-react';

interface HeatingSettingsFormProps {
  settings: HeatingSettings;
  onSave: (settings: Partial<HeatingSettings>) => void;
  isLoading: boolean;
}

export function HeatingSettingsForm({ settings, onSave, isLoading }: HeatingSettingsFormProps) {
  const [formData, setFormData] = useState(settings);

  const handleChange = (field: keyof HeatingSettings, value: number) => {
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
          Einstellungen für PV-Anlage, Batterie und Temperaturen
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

          <Button type="submit" disabled={isLoading}>
            <Save className="w-4 h-4 mr-2" />
            Speichern
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
