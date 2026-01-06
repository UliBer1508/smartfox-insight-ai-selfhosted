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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSettings(formData);
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
                <SelectItem value="300">5 Minuten (empfohlen)</SelectItem>
                <SelectItem value="600">10 Minuten (sparsam)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Collector muss diese Einstellung übernehmen. Bei 5 Min: ~8.640 Datensätze/Monat
            </p>
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
          <div className="flex gap-3">
            <Button type="submit" disabled={isLoading}>
              Speichern
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleRunCleanup}
              disabled={isRunningCleanup}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isRunningCleanup ? 'Läuft...' : 'Jetzt bereinigen'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
