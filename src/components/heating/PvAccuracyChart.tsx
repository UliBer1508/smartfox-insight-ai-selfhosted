import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sun, TrendingUp, Target } from 'lucide-react';
import { usePvAccuracy } from '@/hooks/usePvAccuracy';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

type TimeRange = '7d' | '30d' | '90d';

/**
 * PvAccuracyChart — zeigt die "Lernkurve" der PV-Prognose:
 * Prognose vs. tatsächliche Produktion pro Tag, plus tägliche Abweichung.
 * Datenquelle: pv_forecast_accuracy (nächtlicher Job record-pv-accuracy).
 * Vorbild: SolarGainChart.
 */
export function PvAccuracyChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

  const { data, isLoading } = usePvAccuracy(days);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-yellow-500" />
            PV-Prognose vs. Realität
          </CardTitle>
          <div className="flex gap-1">
            {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Lade Daten...
          </div>
        ) : !data || data.rowCount === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <TrendingUp className="h-12 w-12 opacity-50" />
            <div className="text-center">
              <p className="font-medium">Noch keine Genauigkeitsdaten vorhanden</p>
              <p className="text-sm mt-1">
                Jede Nacht wird ein Datenpunkt (Prognose vs. tatsächliche Produktion) erfasst.
              </p>
              <p className="text-sm">
                Nach einigen Tagen entsteht hier eine aussagekräftige Kurve.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    className="text-muted-foreground"
                  />
                  <YAxis
                    yAxisId="kwh"
                    orientation="left"
                    domain={[0, 'dataMax + 5']}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v}`}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    yAxisId="ratio"
                    orientation="right"
                    domain={[0, 'dataMax + 0.2']}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v}`}
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    formatter={(value: number, name: string) => {
                      if (value == null) return ['—', name];
                      if (name === 'Verhältnis') return [value.toFixed(2), name];
                      return [`${value.toFixed(1)} kWh`, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />

                  {/* Referenzlinie ratio = 1.0 (perfekte Prognose) */}
                  <ReferenceLine
                    yAxisId="ratio"
                    y={1}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />

                  {/* Ratio als dezente Balken im Hintergrund */}
                  <Bar
                    yAxisId="ratio"
                    dataKey="ratio"
                    name="Verhältnis"
                    fill="hsl(var(--muted-foreground))"
                    fillOpacity={0.15}
                    barSize={14}
                  />

                  {/* Prognose-Linie */}
                  <Line
                    yAxisId="kwh"
                    type="monotone"
                    dataKey="prognose"
                    name="Prognose"
                    stroke="hsl(217, 91%, 60%)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls
                  />

                  {/* Ist-Linie */}
                  <Line
                    yAxisId="kwh"
                    type="monotone"
                    dataKey="ist"
                    name="Tatsächlich"
                    stroke="hsl(45, 93%, 47%)"
                    strokeWidth={2.5}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Fußzeile: Kennzahlen */}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {data.rowCount} Tage erfasst
              </span>
              {data.avgRatio != null && (
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3 text-yellow-500" />
                  Ø Ist/Prognose: {data.avgRatio.toFixed(2)}
                  {data.avgRatio > 1.1 && ' (Prognose unterschätzt)'}
                  {data.avgRatio < 0.9 && ' (Prognose überschätzt)'}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Sun className="h-3 w-3 text-yellow-500" />
                Gelb = tatsächlich, Blau gestrichelt = Prognose
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
