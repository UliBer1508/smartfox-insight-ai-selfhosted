import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type Granularity = 'week' | 'month';

export interface PeriodPoint {
  key: string;          // "2026-W18" or "2026-04"
  label: string;        // "KW 18" or "Apr 26"
  startDate: string;    // ISO date
  scr: number;          // 0..1 (avg)
  coverage: number;     // 0..1 (avg)
  pvKwh: number;
  gridKwh: number;
  score: number;
  dayCount: number;
}

interface RawRow {
  date: string;
  kpi_self_consumption_ratio: number | null;
  kpi_pv_heating_coverage: number | null;
  kpi_grid_import_kwh: number | null;
  pv_kwh: number | null;
  score: number | null;
}

// ISO week (Mon-Sun)
function isoWeekKey(d: Date): { key: string; start: Date } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  // Monday of week
  const mon = new Date(d);
  const dow = (mon.getDay() + 6) % 7;
  mon.setDate(mon.getDate() - dow);
  return { key: `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`, start: mon };
}

const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function aggregate(rows: RawRow[], granularity: Granularity): PeriodPoint[] {
  const buckets = new Map<string, { rows: RawRow[]; start: Date; label: string }>();
  for (const r of rows) {
    const d = new Date(r.date + 'T00:00:00');
    let key: string;
    let start: Date;
    let label: string;
    if (granularity === 'week') {
      const w = isoWeekKey(d);
      key = w.key;
      start = w.start;
      label = `KW ${w.key.split('W')[1]}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      label = `${MONTHS_DE[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
    }
    if (!buckets.has(key)) buckets.set(key, { rows: [], start, label });
    buckets.get(key)!.rows.push(r);
  }
  const out: PeriodPoint[] = [];
  for (const [key, bucket] of buckets.entries()) {
    const n = bucket.rows.length;
    const avg = (sel: (r: RawRow) => number) =>
      bucket.rows.reduce((a, r) => a + sel(r), 0) / n;
    const sum = (sel: (r: RawRow) => number) =>
      bucket.rows.reduce((a, r) => a + sel(r), 0);
    out.push({
      key,
      label: bucket.label,
      startDate: bucket.start.toISOString(),
      scr: avg((r) => Number(r.kpi_self_consumption_ratio || 0)),
      coverage: avg((r) => Number(r.kpi_pv_heating_coverage || 0)),
      pvKwh: sum((r) => Number(r.pv_kwh || 0)),
      gridKwh: sum((r) => Number(r.kpi_grid_import_kwh || 0)),
      score: avg((r) => Number(r.score || 0)),
      dayCount: n,
    });
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return out;
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: meanY - slope * meanX };
}

export type RangeKey = '3m' | '6m' | '12m' | 'thisYear' | 'lastYear';

function resolveRange(range: RangeKey): { from: Date; to: Date | null } {
  const now = new Date();
  if (range === 'thisYear') {
    return { from: new Date(now.getFullYear(), 0, 1), to: null };
  }
  if (range === 'lastYear') {
    return {
      from: new Date(now.getFullYear() - 1, 0, 1),
      to: new Date(now.getFullYear() - 1, 11, 31),
    };
  }
  const months = range === '3m' ? 3 : range === '6m' ? 6 : 12;
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  return { from, to: null };
}

export function useYearlyStats(granularity: Granularity, range: RangeKey | number) {
  const rangeKey: RangeKey = typeof range === 'number'
    ? (range === 3 ? '3m' : range === 6 ? '6m' : '12m')
    : range;
  const [rows, setRows] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { from, to } = resolveRange(rangeKey);
        let q = supabase
          .from('daily_pattern_scores')
          .select('date, kpi_self_consumption_ratio, kpi_pv_heating_coverage, kpi_grid_import_kwh, pv_kwh, score')
          .gte('date', from.toISOString().slice(0, 10));
        if (to) q = q.lte('date', to.toISOString().slice(0, 10));
        const { data, error: err } = await q.order('date', { ascending: true }).limit(500);
        if (err) throw err;
        if (!cancelled) setRows((data || []) as RawRow[]);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  const points = useMemo(() => aggregate(rows, granularity), [rows, granularity]);

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const scrs = points.map((p) => p.scr);
    const reg = linearRegression(scrs);
    // slope is per-period; convert to per-month
    const periodsPerMonth = granularity === 'week' ? 4.345 : 1;
    const slopePerMonth = reg.slope * periodsPerMonth;
    const best = points.reduce((a, b) => (b.scr > a.scr ? b : a));
    const worst = points.reduce((a, b) => (b.scr < a.scr ? b : a));
    const deltaRange = scrs[scrs.length - 1] - scrs[0];
    return {
      slopePerMonth,
      deltaRange,
      best,
      worst,
      totalPv: points.reduce((a, p) => a + p.pvKwh, 0),
      totalGrid: points.reduce((a, p) => a + p.gridKwh, 0),
      regression: reg,
    };
  }, [points, granularity]);

  return { points, stats, loading, error, rawDayCount: rows.length };
}
