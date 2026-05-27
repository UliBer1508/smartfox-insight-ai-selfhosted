import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Sparkles, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAnalysisSummary, type StatsRange } from '@/hooks/useAnalysisSummary';

interface Props {
  range: StatsRange;
}

const pct = (v: number) => `${(v * 100).toFixed(0)} %`;
const pp = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pp`;

function Sparkline({ values, max = 1 }: { values: number[]; max?: number }) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 24;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(h - (v / max) * h).toFixed(2)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6 text-primary" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export const ProgressCockpit: React.FC<Props> = ({ range }) => {
  const { data, loading, generating, generate, error } = useAnalysisSummary(range);

  if (loading && !data) {
    return (
      <div className="rounded-lg border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
        Lade Statistik …
      </div>
    );
  }

  const stats = data?.stats;
  const hasStats = !!stats;
  const scr = stats?.latest_scr ?? 0;
  const delta = stats?.delta_scr ?? 0;
  const TrendIcon = delta > 0.005 ? TrendingUp : delta < -0.005 ? TrendingDown : Minus;
  const trendClass = delta > 0.005 ? 'text-emerald-600' : delta < -0.005 ? 'text-rose-600' : 'text-muted-foreground';
  const series = stats?.series?.map((s) => s.scr) ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Hero Gauge */}
        <div className="rounded-lg border bg-card p-4 sm:col-span-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Eigenverbrauch</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-primary">
              {hasStats ? pct(scr) : '–'}
            </span>
            {hasStats && (
              <span className={cn('text-xs font-medium flex items-center gap-1', trendClass)}>
                <TrendIcon className="w-3 h-3" />
                {pp(delta)}
              </span>
            )}
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary/60 to-primary"
              style={{ width: `${Math.max(0, Math.min(100, scr * 100))}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">Ziel: 100 %</div>
        </div>

        {/* Trend */}
        <div className="rounded-lg border bg-card p-4 sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              Trend ({stats?.days_in_range ?? 0} Tage)
            </span>
            {hasStats && (
              <span className="text-xs text-muted-foreground">
                Ø {pct(stats.avg_scr)} · Best {pct(stats.best_scr)} · Min {pct(stats.worst_scr)}
              </span>
            )}
          </div>
          <div className="mt-2">
            {series.length >= 2 ? (
              <Sparkline values={series} max={1} />
            ) : (
              <div className="text-xs text-muted-foreground py-2">Zu wenige Datenpunkte – Backfill starten.</div>
            )}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Heizung aus PV</div>
              <div className="font-semibold">{hasStats ? pct(stats.latest_coverage) : '–'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Netzbezug</div>
              <div className="font-semibold">
                {hasStats ? `${stats.latest_grid_import_kwh.toFixed(2)} kWh` : '–'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Score</div>
              <div className="font-semibold">{hasStats ? `${stats.latest_score.toFixed(0)}/100` : '–'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ML progress strip */}
      {hasStats && stats.ml_event_count > 0 && (
        <div className="rounded-lg border bg-muted/20 px-3 py-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            ML-Lernfortschritt · {stats.ml_event_count} Events
          </span>
          <span className="font-medium">
            Ø Reward {stats.ml_avg_reward !== null ? stats.ml_avg_reward.toFixed(2) : '–'}
          </span>
        </div>
      )}

      {/* AI Summary */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">KI-Zusammenfassung</span>
          </div>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={generate} disabled={generating}>
                  {generating ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                  {data ? 'Text neu erzeugen' : 'Text erzeugen'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs text-xs">
                Erzeugt den KI-Klartext aus den bereits berechneten Tagesscores neu.
                Läuft normalerweise automatisch direkt nach der Tages-, Wochen- bzw. Monatsauswertung
                und beim Öffnen, falls der Cache veraltet ist.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {error && <div className="text-xs text-rose-600 mb-2">{error}</div>}
        {data?.summary ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{data.summary}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {generating ? 'Wird erzeugt …' : 'Noch keine Zusammenfassung verfügbar.'}
          </p>
        )}
        {data?.generated_at && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            Stand: {new Date(data.generated_at).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })}
            <span className="ml-1">· aktualisiert sich automatisch</span>
          </div>
        )}
      </div>
    </div>
  );
};
