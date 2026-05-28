import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Battery, CheckCircle2, AlertTriangle, Bot } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBatterySocSuggestions } from '@/hooks/useBatterySocSuggestions';

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
  const [heatingMinSoc, setHeatingMinSoc] = useState(80);
  const { pending, decide } = useBatterySocSuggestions();

  useEffect(() => {
    const load = async () => {
      const [{ data: settings }, { data: sys }] = await Promise.all([
        supabase.from('heating_settings').select('heating_min_battery_soc').limit(1).maybeSingle(),
        supabase.from('system_settings').select('value').eq('key', 'battery_reserve_validation').maybeSingle(),
      ]);
      if (settings?.heating_min_battery_soc) setHeatingMinSoc(settings.heating_min_battery_soc);
      if (sys?.value) setValidation(sys.value as ValidationStatus);
    };
    load();
  }, []);

  const heatingLocked = currentSoc !== undefined && currentSoc < heatingMinSoc;
  const morningSoc = validation?.actual_morning_soc;
  const held = validation?.reserve_held;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Battery className="w-4 h-4" />
          Batterie-Reserve
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* SOC-Skala — eine einzige Schwelle: heating_min_battery_soc */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span className="text-foreground font-medium">
              Aktuell: {currentSoc ?? '—'}%
            </span>
            <span>100%</span>
          </div>
          <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
            {/* Sperr-Zone (rot) bis heating_min_battery_soc */}
            <div
              className="absolute inset-y-0 left-0 bg-destructive/30"
              style={{ width: `${heatingMinSoc}%` }}
            />
            {currentSoc !== undefined && (
              <div
                className="absolute inset-y-0 w-1 bg-primary"
                style={{ left: `calc(${currentSoc}% - 2px)` }}
              />
            )}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span className="text-destructive">Heizung-Sperre {heatingMinSoc}%</span>
            <span>frei ab {heatingMinSoc}%</span>
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between text-xs pt-2 border-t">
          <span className="text-muted-foreground">Hartes SOC-Gate für Heizung</span>
          {currentSoc !== undefined && (
            <Badge variant={heatingLocked ? 'destructive' : 'secondary'} className="text-[10px]">
              {heatingLocked ? `🔒 Gesperrt (${currentSoc}%)` : `✓ Frei (${currentSoc}%)`}
            </Badge>
          )}
        </div>

        {/* KI-Vorschlag inline (einziger Empfehlungs-Kanal) */}
        {pending && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-start gap-2 text-xs">
              <Bot className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="space-y-0.5 flex-1">
                <div className="font-medium text-foreground">
                  KI schlägt {pending.new_value}% vor (aktuell {pending.old_value}%)
                </div>
                {pending.reason_text && (
                  <div className="text-muted-foreground">{pending.reason_text}</div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={() => decide(pending.id, 'accept')}>
                Übernehmen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => decide(pending.id, 'dismiss')}
              >
                Verwerfen
              </Button>
            </div>
          </div>
        )}

        {/* Validierungs-Info (informativ, ohne separate Empfehlung) */}
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
