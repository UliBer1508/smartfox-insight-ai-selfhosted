import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SmartfoxSettings } from '@/types/energy';
import { Settings, Wifi, Save, TestTube } from 'lucide-react';

interface SettingsPanelProps {
  settings: SmartfoxSettings;
  onSave: (settings: Partial<SmartfoxSettings>) => Promise<boolean>;
  onTest: () => Promise<boolean>;
  isLoading?: boolean;
}

export function SettingsPanel({ settings, onSave, onTest, isLoading }: SettingsPanelProps) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(localSettings);
    setIsSaving(false);
  };

  const handleTest = async () => {
    setIsTesting(true);
    await onTest();
    setIsTesting(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Smartfox Verbindung
        </CardTitle>
        <CardDescription>
          Konfiguriere die Verbindung zu deinem Smartfox Energy Manager im lokalen Netzwerk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smartfox-ip">IP-Adresse</Label>
            <div className="relative">
              <Wifi className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="smartfox-ip"
                value={localSettings.smartfox_ip}
                onChange={(e) => setLocalSettings({ ...localSettings, smartfox_ip: e.target.value })}
                placeholder="192.168.1.100"
                className="pl-10 font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-path">API Pfad</Label>
            <Input
              id="api-path"
              value={localSettings.api_path}
              onChange={(e) => setLocalSettings({ ...localSettings, api_path: e.target.value })}
              placeholder="/power"
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="polling-interval">Abfrageintervall (Sekunden)</Label>
            <Input
              id="polling-interval"
              type="number"
              min={10}
              max={300}
              value={localSettings.polling_interval}
              onChange={(e) => setLocalSettings({ ...localSettings, polling_interval: parseInt(e.target.value) || 60 })}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label>Datenerfassung</Label>
            <div className="flex items-center gap-3 pt-2">
              <Switch
                checked={localSettings.is_active}
                onCheckedChange={(checked) => setLocalSettings({ ...localSettings, is_active: checked })}
              />
              <span className="text-sm text-muted-foreground">
                {localSettings.is_active ? 'Aktiv' : 'Inaktiv'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button 
            variant="outline" 
            onClick={handleTest}
            disabled={isTesting || isLoading}
          >
            <TestTube className="w-4 h-4 mr-2" />
            {isTesting ? 'Teste...' : 'Verbindung testen'}
          </Button>
          
          <Button 
            onClick={handleSave}
            disabled={isSaving || isLoading}
          >
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Speichert...' : 'Speichern'}
          </Button>
        </div>

        <div className="p-4 rounded-lg bg-muted/50 border border-dashed">
          <p className="text-sm text-muted-foreground">
            <strong>Hinweis:</strong> Die Smartfox API ist nur im lokalen Netzwerk erreichbar. 
            Diese App muss auf einem Gerät im selben Netzwerk wie der Smartfox laufen.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
