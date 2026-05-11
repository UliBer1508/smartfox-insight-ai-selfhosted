import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useYearlyStats, type Granularity } from '@/hooks/useYearlyStats';

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)} %`;
const ppNum = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} pp`;

export const YearTrendChart: React.FC = () => {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [monthsBack, setMonthsBack] = useState(12);
  const { points, stats, loading, error, rawDayCount } = useYearlyStats(granularity, monthsBack);

  // 4-period moving average
  const chartData = points.map((p, i) => {
    const window = points.slice(Math.max(0, i - 3), i + 1);
    const ma = window.reduce((a, b) => a + b.scr, 0) / window.length;
    const trendY = stats ? stats.regression.intercept + stats.regression.slope * i : 0;
    return {
      label: p.label,
      scrPct: p.scr * 100,
      maPct: ma * 100,
      trendPct: Math.max(0, Math.min(100, trendY * 100)),
      pvKwh: p.pvKwh,
      gridKwh: p.gridKwh,
      coveragePct: p.coverage * 100,
      score: p.score,
      dayCount: p.dayCount,
    };
  });

  const TrendIcon = stats && stats.slopePerMonth > 0.001
    ? TrendingUp
    : stats && stats.slopePerMonth < -0.001
      ? TrendingDown
      : Minus;
  const trendClass = stats && stats.slopePerMonth > 0.001
    ? 'text-emerald-600'
    : stats && stats.slopePerMonth < -0.001
      ? 'text-rose-600'
      : 'text-muted-foreground';

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Granularität</Label>
          <ToggleGroup
            type="single"
            value={granularity}
            onValueChange={(v) => v && setGranularity(v as Granularity)}
            size="sm"
          >
            <ToggleGroupItem value="week">Woche</ToggleGroupItem>
            <ToggleGroupItem value="month">Monat</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Zeitraum</Label>
          <Select value={String(monthsBack)} onValueChange={(v) => setMonthsBack(parseInt(v, 10))}>
            <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Letzte 3 Monate</SelectItem>
              <SelectItem value="6">Letzte 6 Monate</SelectItem>
              <SelectItem value="12">Letzte 12 Monate</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Chart */}
      <Card className="p-3">
        {loading ? (
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Lade Verlaufsdaten …
          </div>
        ) : error ? (
          <div className="h-64 flex items-center justify-center text-sm text-rose-600">{error}</div>
        ) : chartData.length < 2 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-2">
            <p>Nicht genug Verlaufsdaten ({rawDayCount} Tage, {chartData.length} Perioden).</p>
            <p className="text-xs">Bitte oben Backfill auf 90 oder mehr Tage ausführen.</p>
          </div>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 10 }}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === 'Eigenverbrauch' || name === 'gleitender Ø' || name === 'Trend')
                      return [`${value.toFixed(1)} %`, name];
                    return [value, name];
                  }}
                  labelFormatter={(l, payload) => {
                    const d = payload?.[0]?.payload;
                    if (!d) return l;
                    return `${l} · ${d.dayCount} Tage`;
                  }}
                />
                <ReferenceLine y={100} stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeOpacity={0.4} />
                <Bar dataKey="scrPct" name="Eigenverbrauch" radius={[3, 3, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={
                        d.scrPct >= 80 ? 'hsl(142 76% 45%)'
                        : d.scrPct >= 60 ? 'hsl(var(--primary))'
                        : d.scrPct >= 40 ? 'hsl(38 92% 55%)'
                        : 'hsl(0 72% 60%)'
                      }
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="maPct"
                  name="gleitender Ø"
                  stroke="hsl(var(--foreground))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="linear"
                  dataKey="trendPct"
                  name="Trend"
                  stroke="hsl(var(--primary))"
                  strokeDasharray="5 5"
                  strokeWidth={1.5}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* KPI Strip */}
      {stats && chartData.length >= 2 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-muted-foreground">Trend</div>
            <div className={cn('font-semibold flex items-center gap-1 mt-0.5', trendClass)}>
              <TrendIcon className="w-3 h-3" />
              {ppNum(stats.slopePerMonth)} / Monat
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-muted-foreground">Δ Zeitraum</div>
            <div className="font-semibold mt-0.5">{ppNum(stats.deltaRange)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-muted-foreground">Bestperiode</div>
            <div className="font-semibold mt-0.5">{stats.best.label} · {pct(stats.best.scr)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-muted-foreground">Schlechteste</div>
            <div className="font-semibold mt-0.5">{stats.worst.label} · {pct(stats.worst.scr)}</div>
          </div>
          <div className="rounded-lg border bg-card p-3 col-span-2 sm:col-span-2">
            <div className="text-muted-foreground">Σ PV-Ertrag</div>
            <div className="font-semibold mt-0.5">{stats.totalPv.toFixed(1)} kWh</div>
          </div>
          <div className="rounded-lg border bg-card p-3 col-span-2 sm:col-span-2">
            <div className="text-muted-foreground">Σ Netzbezug</div>
            <div className="font-semibold mt-0.5">{stats.totalGrid.toFixed(1)} kWh</div>
          </div>
        </div>
      )}
    </div>
  );
};
