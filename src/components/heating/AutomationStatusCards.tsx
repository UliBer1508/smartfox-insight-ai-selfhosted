import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bot, ArrowRight, CheckCircle2, Shield, Activity, Battery, Sun, Brain, ChevronDown, ChevronUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useBatterySocSuggestions } from '@/hooks/useBatterySocSuggestions';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { supabase } from '@/integrations/supabase/client';
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
          <MlCacheChip />
        </div>
      </CardContent>
    </Card>
  );
}

// ML-Cache-Alter (Robustheit 4): zeigt wann die letzte KI-Entscheidung berechnet wurde
function MlCacheChip() {
  const [ageMin, setAgeMin] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchCache = async () => {
      const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'last_ml_cache')
        .maybeSingle();
      if (cancelled) return;
      const ts = (data?.value as any)?.timestamp;
      if (typeof ts === 'number') {
        setAgeMin(Math.floor((Date.now() - ts) / 60000));
      } else {
        setAgeMin(null);
      }
    };
    fetchCache();
    const id = setInterval(fetchCache, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (ageMin == null) return null;
  const stale = ageMin >= 45;
  const label = stale
    ? `KI-Analyse wird beim nächsten Heartbeat erneuert (vor ${ageMin} min)`
    : `KI-Entscheidungen: vor ${ageMin} min berechnet`;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-xs ${
        stale
          ? 'bg-warning/15 text-foreground border-warning/40'
          : 'bg-muted text-muted-foreground border-border'
      }`}
    >
      <Brain className="w-3 h-3" />
      {label}
    </span>
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
  const { pending, history, loading, decide } = useBatterySocSuggestions();

  if (loading) {
    return (
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            KI Batterie-Empfehlung
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Prüfe offene Batterie-Gate-Vorschläge …
        </CardContent>
      </Card>
    );
  }

  if (!pending) {
    const latest = history[0];

    return (
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              KI Batterie-Empfehlung
            </span>
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-foreground">
              Kein offener Vorschlag
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Aktuell liegt keine neue Batterie-Gate-Empfehlung zur Bestätigung vor.</p>
          {latest && (
            <p>
              Letzter Eintrag: {format(new Date(latest.created_at), 'dd.MM.yyyy HH:mm', { locale: de })} · {latest.old_value}% → {latest.new_value}% · {latest.status === 'accepted' ? 'übernommen' : latest.status === 'dismissed' ? 'abgelehnt' : 'offen'}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

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
// Verlaufs-Karte — kompakt & einklappbar, harte Höhendeckelung
// ---------------------------------------------------------------------------
type BatterySocSuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export function BatterySocHistoryCard() {
  const { history } = useBatterySocSuggestions();
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  const total = history.length;
  const preview = history.slice(0, 2);
  const fullList = history.slice(0, 30);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span>Verlauf — Batterie-Gate-Änderungen</span>
          <Badge variant="secondary" className="font-normal">
            {total} {total === 1 ? 'Eintrag' : 'Einträge'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!expanded ? (
          <div className="space-y-1">
            {preview.map((h) => (
              <HistoryRow key={h.id} item={h} showReason={false} />
            ))}
            {total > preview.length && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(true)}
                className="w-full justify-center h-7 text-xs text-muted-foreground mt-1"
              >
                <ChevronDown className="w-3.5 h-3.5 mr-1" />
                Alle anzeigen ({total})
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
              {fullList.map((h) => (
                <HistoryRow key={h.id} item={h} showReason />
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
              className="w-full justify-center h-7 text-xs text-muted-foreground mt-1"
            >
              <ChevronUp className="w-3.5 h-3.5 mr-1" />
              Einklappen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryRow({
  item,
  showReason,
}: {
  item: ReturnType<typeof useBatterySocSuggestions>['history'][number];
  showReason: boolean;
}) {
  const row = (
    <div className="flex items-baseline gap-2 text-xs py-1 border-t first:border-t-0">
      <StatusDot status={item.status as BatterySocSuggestionStatus} />
      <span className="text-muted-foreground whitespace-nowrap tabular-nums">
        {format(new Date(item.created_at), 'dd.MM. HH:mm', { locale: de })}
      </span>
      <span className="font-mono whitespace-nowrap">
        {item.old_value}% → {item.new_value}%
      </span>
      {showReason && item.reason_text && (
        <span className="text-muted-foreground truncate flex-1 min-w-0">{item.reason_text}</span>
      )}
    </div>
  );

  if (showReason && item.reason_text) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs leading-relaxed">
            {item.reason_text}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return row;
}

const STATUS_DOT: Record<BatterySocSuggestionStatus, { cls: string; title: string }> = {
  pending: { cls: 'bg-warning', title: 'Offen' },
  accepted: { cls: 'bg-success', title: 'Übernommen' },
  dismissed: { cls: 'bg-muted-foreground', title: 'Abgelehnt' },
};

function StatusDot({ status }: { status: BatterySocSuggestionStatus }) {
  const cfg = STATUS_DOT[status] ?? STATUS_DOT.dismissed;
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${cfg.cls}`}
      title={cfg.title}
      aria-label={cfg.title}
    />
  );
}
