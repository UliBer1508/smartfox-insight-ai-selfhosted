import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Battery, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ValidationStatus {
  last_check?: string;
  checked_date?: string;
  reserve_held?: boolean;
  actual_morning_soc?: number | null;
  min_soc_during_night?: number | null;
  target_reserve?: number;
  night_consumption_kwh?: number | null;
  heating_battery_used_kwh?: number | null;
  suggestion?: string;
}

interface Props {
  currentSoc?: number;
}

export function BatteryReserveStatus({ currentSoc }: Props) {
  const [validation, setValidation] = useState<ValidationStatus | null>(null);
  const [reserve, setReserve] = useState(60);

  useEffect(() => {
    const load = async () => {
      const [{ data: settings }, { data: sys }] = await Promise.all([
        supabase.from('heating_settings').select('battery_reserve_for_night_soc').limit(1).maybeSingle(),
        supabase.from('system_settings').select('value').eq('key', 'battery_reserve_validation').maybeSingle(),
      ]);
      if (settings?.battery_reserve_for_night_soc) setReserve(settings.battery_reserve_for_night_soc);
      if (sys?.value) setValidation(sys.value as ValidationStatus);
    };
    load();
  }, []);

  const morningSoc = validation?.actual_morning_soc;
  const held = validation?.reserve_held;
  const bufferZone = reserve + 20;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Battery className="w-4 h-4" />
          Batterie-Reserve
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* SOC-Skala */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span className="text-foreground font-medium">
              Aktuell: {currentSoc ?? '—'}%
            </span>
            <span>100%</span>
          </div>
          <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
            {/* Reserve-Zone (rot, schützt) */}
            <div
              className="absolute inset-y-0 left-0 bg-destructive/30"
              style={{ width: `${reserve}%` }}
            />
            <div
              className="absolute inset-y-0 bg-muted"
              style={{ left: `${reserve}%`, width: `${bufferZone - reserve}%` }}
            />
            {currentSoc !== undefined && (
              <div
                className="absolute inset-y-0 w-1 bg-primary"
                style={{ left: `calc(${currentSoc}% - 2px)` }}
              />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span className="text-destructive">Reserve {reserve}%</span>
            <span>Puffer-Grenze {bufferZone}%</span>
          </div>
        </div>

        {/* Validierung */}
        {validation && morningSoc !== null && morningSoc !== undefined ? (
          <div className="flex items-start gap-2 text-xs pt-2 border-t">
            {held ? (
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div>
                Letzter Morgen-SOC: <strong>{morningSoc}%</strong>
                <Badge variant={held ? 'secondary' : 'destructive'} className="ml-2 text-[10px]">
                  {held ? '✓ gehalten' : '⚠ unterschritten'}
                </Badge>
              </div>
              {validation.night_consumption_kwh != null && (
                <div className="text-muted-foreground">
                  Nachtverbrauch: {Number(validation.night_consumption_kwh).toFixed(1)} kWh
                </div>
              )}
              {validation.heating_battery_used_kwh != null && validation.heating_battery_used_kwh > 0 && (
                <div className="text-muted-foreground">
                  Heizung aus Batterie (gestern): {Number(validation.heating_battery_used_kwh).toFixed(1)} kWh
                </div>
              )}
              {validation.suggestion && validation.suggestion !== 'ok' && (
                <div className="text-destructive">
                  Empfehlung: {validation.suggestion.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Validierung läuft täglich nach 09:00 — noch keine Daten verfügbar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
