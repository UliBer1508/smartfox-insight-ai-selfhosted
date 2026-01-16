import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { Calendar, ExternalLink, Settings2, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function TuyaSubscriptionAlert() {
  const {
    expiresAt,
    warningDays,
    daysRemaining,
    status,
    formattedExpiry,
    isLoading,
    updateSettings,
  } = useSubscriptionStatus();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editExpiresAt, setEditExpiresAt] = useState(expiresAt || '');
  const [editWarningDays, setEditWarningDays] = useState(warningDays.toString());
  const [isSaving, setIsSaving] = useState(false);

  const handleOpenDialog = () => {
    setEditExpiresAt(expiresAt || '');
    setEditWarningDays(warningDays.toString());
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const success = await updateSettings({
      expiresAt: editExpiresAt,
      warningDays: parseInt(editWarningDays) || 30,
    });
    setIsSaving(false);
    if (success) {
      setIsDialogOpen(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Tuya Subscription
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-6 w-48" />
        </CardContent>
      </Card>
    );
  }

  const statusConfig = {
    valid: {
      color: 'bg-green-500/10 text-green-600 border-green-500/20',
      icon: CheckCircle,
      label: 'Gültig',
    },
    warning: {
      color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
      icon: AlertTriangle,
      label: 'Läuft bald ab',
    },
    expired: {
      color: 'bg-red-500/10 text-red-600 border-red-500/20',
      icon: XCircle,
      label: 'Abgelaufen',
    },
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <Card className={status !== 'valid' ? 'border-yellow-500/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Tuya Subscription
          </CardTitle>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleOpenDialog}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Tuya Subscription Einstellungen</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="expiresAt">Ablaufdatum</Label>
                  <Input
                    id="expiresAt"
                    type="date"
                    value={editExpiresAt}
                    onChange={(e) => setEditExpiresAt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Aktualisieren Sie das Datum nach einer Verlängerung
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="warningDays">Vorwarnung (Tage)</Label>
                  <Input
                    id="warningDays"
                    type="number"
                    min="1"
                    max="365"
                    value={editWarningDays}
                    onChange={(e) => setEditWarningDays(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Warnung anzeigen X Tage vor Ablauf
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Abbrechen
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Speichern...' : 'Speichern'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={config.color}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {config.label}
          </Badge>
          {formattedExpiry && (
            <span className="text-sm text-muted-foreground">
              bis {formattedExpiry}
            </span>
          )}
          {daysRemaining !== null && daysRemaining > 0 && (
            <span className="text-sm text-muted-foreground">
              (noch {daysRemaining} Tage)
            </span>
          )}
        </div>

        {status !== 'valid' && (
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span>
              {status === 'expired' 
                ? 'Subscription abgelaufen! Thermostat-Steuerung nicht verfügbar.'
                : `Subscription läuft in ${daysRemaining} Tagen ab!`}
            </span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => window.open('https://iot.tuya.com/cloud/products', '_blank')}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Tuya IoT Platform öffnen
        </Button>
      </CardContent>
    </Card>
  );
}
