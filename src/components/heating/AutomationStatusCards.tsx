import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bot, ArrowRight, CheckCircle2, Shield, Activity, Battery, Sun } from 'lucide-react';
import { useBatterySocSuggestions } from '@/hooks/useBatterySocSuggestions';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// ---------------------------------------------------------------------------
// Automations-Status: permanent oberhalb der Raum-Übersicht
// Werte live aus heating_settings (Polling via useHeatingSettings 30s reicht);
// keine separate Realtime-Subscription, um Quota zu schonen.
// ---------------------------------------------------------------------------
export function AutomationStatusCard() {
  const { settings, isLoading } = useHeatingSettings();
  const { history } = useBatterySocSuggestions();

  if (isLoading) return null;

  const lastAccepted = history.find((h) => h.status === 'accepted');
  const gateSource = lastAccepted
    ? `KI-Vorschlag übernommen am ${format(new Date(lastAccepted.decided_at ?? lastAccepted.created_at), 'dd.MM.yyyy', { locale: de })}`
    : 'manuell gesetzt';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Automations-Status
          </span>
          <Badge className="bg-success text-success-foreground">Aktiv</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 4 Metric-Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            icon={<Battery className="w-4 h-4" />}
            label="Batterie-Gate"
            value={`${settings.heating_min_battery_soc ?? 80}%`}
            sub={gateSource}
          />
          <MetricCard
            icon={<Shield className="w-4 h-4" />}
            label="SOC-Gate-Modus"
            value={settings.heating_soc_gate_mode === 'soft' ? 'Soft' : 'Strict'}
            sub={settings.heating_soc_gate_mode === 'soft' ? 'tolerant' : 'hart'}
          />
          <MetricCard
            icon={<Sun className="w-4 h-4" />}
            label="Mikro-Budget"
            value={settings.micro_budget_enabled ? 'Ein' : 'Aus'}
            sub={`Floor ${(settings.heating_min_battery_soc ?? 80) + 5}%`}
          />
          <MetricCard
            icon={<Activity className="w-4 h-4" />}
            label="Nacht-Modus"
            value={settings.night_heating_mode === 'maintain' ? 'Maintain' : 'Frost-only'}
            sub={`${settings.night_start_time ?? '22:00'} – ${settings.night_end_time ?? '06:00'}`}
          />
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Chip color="muted">
            PV-Hysterese: {settings.pv_surplus_threshold_on}W ein / {settings.pv_surplus_threshold_off}W aus
          </Chip>
          <Chip color="muted">WW: Smartfox-autonom</Chip>
          <Chip color="muted">
            Nächste Analyse: {settings.analysis_daily_time ?? '03:30'}
          </Chip>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{sub}</div>
    </div>
  );
}

function Chip({ children, color = 'muted' }: { children: React.ReactNode; color?: 'muted' | 'success' | 'warning' }) {
  const cls =
    color === 'success' ? 'bg-success/15 text-success-foreground border-success/30'
    : color === 'warning' ? 'bg-warning/15 border-warning/40'
    : 'bg-muted text-muted-foreground border-border';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KI-Vorschlags-Karte (nur bei pending)
// ---------------------------------------------------------------------------
export function BatterySocSuggestionCard() {
  const { pending, decide } = useBatterySocSuggestions();
  if (!pending) return null;

  return (
    <Card className="border-2 border-warning/60 bg-warning/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-warning" />
            KI empfiehlt: Batterie-Gate anpassen
          </span>
          <Badge variant="outline" className="border-warning text-warning-foreground bg-warning/20">
            Warte auf Bestätigung
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {format(new Date(pending.created_at), 'dd.MM.yyyy HH:mm', { locale: de })} · ai-parameter-advisor
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Vergleich */}
        <div className="flex items-center justify-center gap-4 py-2">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Aktuell</div>
            <div className="text-3xl font-bold text-muted-foreground">{pending.old_value}%</div>
          </div>
          <ArrowRight className="w-8 h-8 text-warning" />
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Vorschlag</div>
            <div className="text-3xl font-bold text-warning">{pending.new_value}%</div>
          </div>
        </div>

        {/* Begründung */}
        {pending.reason_text && (
          <div className="rounded-md bg-muted p-3 text-sm leading-relaxed">
            {pending.reason_text}
          </div>
        )}

        {/* 3 Metric-Cards */}
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric label="PV morgen" value={pending.pv_forecast_kwh != null ? `${pending.pv_forecast_kwh.toFixed(1)} kWh` : '–'} />
          <MiniMetric label="Ø 7 Tage" value={pending.avg_pv_7d_kwh != null ? `${pending.avg_pv_7d_kwh.toFixed(1)} kWh` : '–'} />
          <MiniMetric label="SOC gestern" value={pending.soc_end_of_day != null ? `${pending.soc_end_of_day}%` : '–'} />
        </div>

        {/* Aktionen */}
        <div className="flex gap-2 pt-1">
          <Button
            onClick={() => decide(pending.id, 'accept')}
            className="flex-1 border-2 border-success bg-success/10 text-foreground hover:bg-success/20"
            variant="outline"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Übernehmen — Gate auf {pending.new_value}%
          </Button>
          <Button onClick={() => decide(pending.id, 'dismiss')} variant="ghost">
            Ablehnen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-2 text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verlaufs-Karte
// ---------------------------------------------------------------------------
export function BatterySocHistoryCard() {
  const { history } = useBatterySocSuggestions();
  if (history.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Verlauf — Batterie-Gate-Änderungen</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3 font-normal">Zeitpunkt</th>
                <th className="py-1 pr-3 font-normal">Status</th>
                <th className="py-1 pr-3 font-normal">Änderung</th>
                <th className="py-1 font-normal">Begründung</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 10).map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {format(new Date(h.created_at), 'dd.MM. HH:mm', { locale: de })}
                  </td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge status={h.status} />
                  </td>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                    {h.old_value}% → {h.new_value}%
                  </td>
                  <td className="py-1.5 text-muted-foreground line-clamp-2">{h.reason_text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: BatterySocSuggestionStatus }) {
  if (status === 'pending') return <Badge className="bg-warning/20 text-foreground border border-warning/40">Offen</Badge>;
  if (status === 'accepted') return <Badge className="bg-success/20 text-foreground border border-success/40">Übernommen</Badge>;
  return <Badge variant="secondary">Abgelehnt</Badge>;
}
type BatterySocSuggestionStatus = 'pending' | 'accepted' | 'dismissed';
