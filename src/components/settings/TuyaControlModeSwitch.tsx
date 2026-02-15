import { Cloud, HardDrive } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTuyaControlMode } from '@/hooks/useTuyaControlMode';

export function TuyaControlModeSwitch() {
  const { mode, setMode, isLoading } = useTuyaControlMode();
  const isLocal = mode === 'local';

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="control-mode" className="flex items-center gap-2 text-sm font-medium">
          {isLocal ? (
            <HardDrive className="h-4 w-4 text-primary" />
          ) : (
            <Cloud className="h-4 w-4 text-primary" />
          )}
          Steuerungsmodus
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Cloud</span>
          <Switch
            id="control-mode"
            checked={isLocal}
            onCheckedChange={(checked) => setMode(checked ? 'local' : 'cloud')}
            disabled={isLoading}
          />
          <span className="text-xs text-muted-foreground">Lokal</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {isLocal
          ? 'Befehle werden vom lokalen tuya-thermostat Service über LAN ausgeführt.'
          : 'Befehle werden über die Cloud Edge Function gesendet.'}
      </p>
    </div>
  );
}
