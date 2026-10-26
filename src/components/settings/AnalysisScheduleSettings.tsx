// Einstellungen › KI: Zeitplan der KI-Analysen und Datenpflege (Stand 26.10.2026).
// Herausgelöst aus dem früheren AnalysisPanel (Tab Verlauf & Muster); Speichern nur geänderter
// Felder über useHeatingSettings.saveSettings (Konfliktprüfung, siehe src/lib/safeSave.ts).
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Database, Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LastUpdatedBadge } from '@/components/ui/LastUpdatedBadge';
import type { HeatingSettings } from '@/types/heating';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
type SchedulerKey = 'scheduler_daily' | 'scheduler_weekly' | 'scheduler_monthly';

export function AnalysisScheduleSettings({ settings, onSave }: {
  settings: HeatingSettings;
  onSave: (patch: Partial<HeatingSettings>) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Partial<HeatingSettings>>({});
  const [backfillDays, setBackfillDays] = useState(30);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [lastRuns, setLastRuns] = useState<Record<SchedulerKey, string | null>>({ scheduler_daily: null, scheduler_weekly: null, scheduler_monthly: null });

  useEffect(() => {
    supabase.from('system_settings').select('key,value').in('key', ['scheduler_daily', 'scheduler_weekly', 'scheduler_monthly'])
      .then(({ data }) => {
        const next: Record<SchedulerKey, string | null> = { scheduler_daily: null, scheduler_weekly: null, scheduler_monthly: null };
        for (const row of data ?? []) next[row.key as SchedulerKey] = (row.value as { last_run_at?: string } | null)?.last_run_at ?? null;
        setLastRuns(next);
      });
  }, []);

  const get = <K extends keyof HeatingSettings>(k: K) => (draft[k] !== undefined ? draft[k] : settings[k]) as HeatingSettings[K];
  const set = (patch: Partial<HeatingSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = Object.keys(draft).length > 0;

  const runBackfill = async () => {
    setIsBackfilling(true);
    try {
      const { error } = await supabase.functions.invoke('compute-daily-score', { body: { backfill: backfillDays } });
      if (error) throw error;
      toast.success(`Neuberechnung für ${backfillDays} Tage gestartet`);
    } catch (e) {
      toast.error('Neuberechnung fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setIsBackfilling(false);
    }
  };

  // Als Funktion aufgerufen (nicht als <Komponente>), damit Eingabefelder beim Tippen nicht neu montiert werden.
  const box = ({ title, text, enabledKey, timeKey, lastRun, stale, extra }: {
    title: string; text: string; enabledKey: keyof HeatingSettings; timeKey: keyof HeatingSettings;
    lastRun: string | null; stale: number; extra?: React.ReactNode;
  }) => {
    const enabled = Boolean(get(enabledKey));
    return (
      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">{title}<LastUpdatedBadge iso={lastRun} staleAfterMs={stale} /></div>
            <div className="text-xs text-muted-foreground">{text}</div>
          </div>
          <Switch checked={enabled} aria-label={`${title} automatisch`} onCheckedChange={(v) => set({ [enabledKey]: v } as Partial<HeatingSettings>)} />
        </div>
        {enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Uhrzeit</Label>
              <Input type="time" className="h-9" value={String(get(timeKey) ?? '').slice(0, 5)}
                onChange={(e) => set({ [timeKey]: e.target.value } as Partial<HeatingSettings>)} />
            </div>
            {extra}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {box({
        title: 'Tagesmuster', text: 'Die KI wertet täglich das Verbrauchsmuster aus und erkennt Abweichungen.',
        enabledKey: 'analysis_daily_enabled', timeKey: 'analysis_daily_time', lastRun: lastRuns.scheduler_daily, stale: 26 * 3600 * 1000,
      })}
      {box({
        title: 'Wochenvergleich', text: 'Mehr oder weniger PV-Ertrag als die Vorwoche?',
        enabledKey: 'analysis_weekly_enabled', timeKey: 'analysis_weekly_time', lastRun: lastRuns.scheduler_weekly, stale: 8 * DAY_MS,
        extra: (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Wochentag</Label>
            <Select value={String(get('analysis_weekly_weekday') ?? 0)} onValueChange={(v) => set({ analysis_weekly_weekday: parseInt(v, 10) })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{WEEKDAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ),
      })}
      {box({
        title: 'Monatsanalyse', text: 'Langzeit-Trends und Strategie für die kommende Jahreszeit.',
        enabledKey: 'analysis_monthly_enabled', timeKey: 'analysis_monthly_time', lastRun: lastRuns.scheduler_monthly, stale: 32 * DAY_MS,
        extra: (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tag im Monat (1–28)</Label>
            <Input type="number" min={1} max={28} className="h-9" value={Number(get('analysis_monthly_dom') ?? 1)}
              onChange={(e) => set({ analysis_monthly_dom: Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)) })} />
          </div>
        ),
      })}
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft({})}>Verwerfen</Button>
          <Button size="sm" onClick={async () => { await onSave(draft); setDraft({}); }}><Save className="w-4 h-4 mr-1.5" />Zeitplan speichern</Button>
        </div>
      )}

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-sm font-medium">Datenpflege</div>
        <div className="text-xs text-muted-foreground">Tageswertungen (Eigenverbrauch, Score) laufen automatisch. Nur neu berechnen, wenn historische Werte fehlen.</div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <Select value={String(backfillDays)} onValueChange={(v) => setBackfillDays(parseInt(v, 10))}>
            <SelectTrigger className="sm:w-48" aria-label="Zeitraum"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Letzte 7 Tage</SelectItem>
              <SelectItem value="30">Letzte 30 Tage</SelectItem>
              <SelectItem value="90">Letzte 90 Tage</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="secondary" onClick={runBackfill} disabled={isBackfilling}>
            {isBackfilling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
            Tageswertungen neu berechnen
          </Button>
        </div>
      </div>
    </div>
  );
}
