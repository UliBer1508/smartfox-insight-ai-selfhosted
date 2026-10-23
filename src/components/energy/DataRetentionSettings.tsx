import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Database, Trash2, Clock, HardDrive } from 'lucide-react';
import { useDataRetentionSettings } from '@/hooks/useDataRetentionSettings';
import { DataRetentionSettings as DataRetentionSettingsType } from '@/types/dataRetention';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export const DataRetentionSettings: React.FC = () => {
  const { settings, saveSettings, isLoading, runCleanupNow } = useDataRetentionSettings();
  const [formData, setFormData] = useState<DataRetentionSettingsType>(settings);
  const [isRunningCleanup, setIsRunningCleanup] = useState(false);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const handleChange = (field: keyof DataRetentionSettingsType, value: number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Nur geänderte Felder speichern
  const changedKeys = (Object.keys(formData) as (keyof DataRetentionSettingsType)[])
    .filter((k) => !['id', 'created_at', 'updated_at', 'last_cleanup_at'].includes(k) && formData[k] !== settings[k]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const patch = Object.fromEntries(changedKeys.map((k) => [k, formData[k]])) as Partial<DataRetentionSettingsType>;
    saveSettings(patch);
  };

  const handleRunCleanup = async () => {
    setIsRunningCleanup(true);
    await runCleanupNow();
    setIsRunningCleanup(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Datenspeicherung
        </CardTitle>
        <CardDescription>
          Konfiguriere Polling-Intervall und automatische Datenbereinigung
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Polling Interval */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Polling-Intervall
            </Label>
            <Select
              value={String(formData.polling_interval_seconds)}
              onValueChange={(value) => handleChange('polling_interval_seconds', parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60">60 Sekunden (höchste Auflösung)</SelectItem>
                <SelectItem value="120">2 Minuten</SelectItem>
                <SelectItem value="300">5 Minuten</SelectItem>
                <SelectItem value="600">10 Minuten</SelectItem>
                <SelectItem value="1800">30 Minuten (Tuya-sparend)</SelectItem>
                <SelectItem value="3600">60 Minuten (Tuya Trial-Limit)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Collector muss diese Einstellung übernehmen. Bei 5 Min: ~8.640 Datensätze/Monat
            </p>
            {formData.polling_interval_seconds !== settings.polling_interval_seconds && (
              <p className="text-xs text-foreground bg-warning/15 border border-warning/40 rounded-md p-2">
                Achtung: Schwellen wie der PV-Genauigkeits-Watchdog (erwartet ~280 Messwerte/Tag bei 5 Min)
                hängen vom Intervall ab und müssen dann mit angepasst werden.
              </p>
            )}
          </div>

          {/* Raw Data Retention */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Rohdaten behalten
            </Label>
            <Select
              value={String(formData.raw_data_retention_days)}
              onValueChange={(value) => handleChange('raw_data_retention_days', parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 Tage</SelectItem>
                <SelectItem value="7">7 Tage (empfohlen)</SelectItem>
                <SelectItem value="14">14 Tage</SelectItem>
                <SelectItem value="30">30 Tage</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Danach werden Rohdaten zu stündlichen Aggregaten zusammengefasst
            </p>
          </div>

          {/* Hourly Retention */}
          <div className="space-y-3">
            <Label>Stündliche Aggregate behalten</Label>
            <Select
              value={String(formData.hourly_retention_days)}
              onValueChange={(value) => handleChange('hourly_retention_days', parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 Tage</SelectItem>
                <SelectItem value="90">90 Tage (empfohlen)</SelectItem>
                <SelectItem value="180">180 Tage</SelectItem>
                <SelectItem value="365">365 Tage</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Danach werden stündliche Daten zu Tagesmustern konsolidiert
            </p>
          </div>

          {/* Auto Cleanup Toggle */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-0.5">
              <Label>Automatische Bereinigung</Label>
              <p className="text-xs text-muted-foreground">
                Alte Daten automatisch aggregieren und löschen
              </p>
            </div>
            <Switch
              checked={formData.auto_cleanup_enabled}
              onCheckedChange={(checked) => handleChange('auto_cleanup_enabled', checked)}
            />
          </div>

          {/* Last Cleanup Info */}
          {settings.last_cleanup_at && (
            <div className="text-sm text-muted-foreground">
              Letzte Bereinigung: {new Date(settings.last_cleanup_at).toLocaleString('de-DE')}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button type="submit" disabled={isLoading || changedKeys.length === 0} className="w-full sm:w-auto">
              Speichern
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isRunningCleanup}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {isRunningCleanup ? 'Läuft...' : 'Jetzt bereinigen'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Daten jetzt bereinigen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Rohdaten älter als {settings.raw_data_retention_days} Tage werden zu Stundenwerten
                    zusammengefasst und anschließend <strong>endgültig gelöscht</strong>. Das läuft ohnehin
                    jede Nacht automatisch – manuell ist es nur selten nötig.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRunCleanup}>Bereinigen</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
