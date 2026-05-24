import React, { forwardRef, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EnergyReading } from '@/types/energy';
import { Brain, TrendingUp, Calendar, CalendarDays, Loader2, Database, Save, LineChart, ChevronDown, Wrench, Info, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { HeatingSettings } from '@/types/heating';
import { ProgressCockpit } from './stats/ProgressCockpit';
import { YearTrendChart } from './stats/YearTrendChart';

type SchedulerKey = 'scheduler_daily' | 'scheduler_weekly' | 'scheduler_monthly' | 'scheduler_match_today';

const formatLastRun = (iso: string | null | undefined): string => {
  if (!iso) return 'noch nicht gelaufen';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unbekannt';
  const fmtTime = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(d);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date());
  const that = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(d);
  if (today === that) return `heute ${fmtTime}`;
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date(Date.now() - 86400000));
  if (yesterday === that) return `gestern ${fmtTime}`;
  const fmtDate = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit' }).format(d);
  return `${fmtDate} ${fmtTime}`;
};

const LastRunBadge: React.FC<{ iso: string | null | undefined }> = ({ iso }) => (
  <span className={cn(
    'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border',
    iso ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
        : 'border-muted bg-muted/40 text-muted-foreground'
  )}>
    <CheckCircle2 className="w-3 h-3" />
    Zuletzt: {formatLastRun(iso)}
  </span>
);

interface AnalysisPanelProps {
  readings: EnergyReading[];
  analysis: string | null;
  isAnalyzing: boolean;
  onAnalyzeDaily: (readings: EnergyReading[]) => void;
  onAnalyzeWeekly: () => void;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export const AnalysisPanel = forwardRef<HTMLDivElement, AnalysisPanelProps>(
  ({ readings, analysis, isAnalyzing, onAnalyzeDaily, onAnalyzeWeekly }, ref) => {
    const { settings, saveSettings } = useHeatingSettings();
    const [draft, setDraft] = useState<Partial<HeatingSettings>>({});
    const [backfillDays, setBackfillDays] = useState<number>(30);
    const [isBackfilling, setIsBackfilling] = useState(false);
    const [isMonthlyRunning, setIsMonthlyRunning] = useState(false);
    const [devOpen, setDevOpen] = useState(false);
    const [lastRuns, setLastRuns] = useState<Record<SchedulerKey, string | null>>({
      scheduler_daily: null, scheduler_weekly: null, scheduler_monthly: null, scheduler_match_today: null,
    });

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        const { data } = await supabase
          .from('system_settings')
          .select('key,value')
          .in('key', ['scheduler_daily', 'scheduler_weekly', 'scheduler_monthly', 'scheduler_match_today']);
        if (cancelled || !data) return;
        const next: Record<SchedulerKey, string | null> = {
          scheduler_daily: null, scheduler_weekly: null, scheduler_monthly: null, scheduler_match_today: null,
        };
        for (const row of data) {
          const v = row.value as { last_run_at?: string } | null;
          next[row.key as SchedulerKey] = v?.last_run_at ?? null;
        }
        setLastRuns(next);
      };
      load();
      const id = setInterval(load, 5 * 60 * 1000);
      return () => { cancelled = true; clearInterval(id); };
    }, []);

    const get = <K extends keyof HeatingSettings>(k: K): HeatingSettings[K] =>
      (draft[k] !== undefined ? draft[k] : settings[k]) as HeatingSettings[K];

    const set = (patch: Partial<HeatingSettings>) =>
      setDraft((d) => ({ ...d, ...patch }));

    const persist = async () => {
      if (Object.keys(draft).length === 0) return;
      await saveSettings(draft);
      setDraft({});
    };

    const runBackfill = async () => {
      setIsBackfilling(true);
      try {
        const { error } = await supabase.functions.invoke('compute-daily-score', {
          body: { backfill: backfillDays },
        });
        if (error) throw error;
        toast.success(`Backfill für ${backfillDays} Tage gestartet`);
      } catch (e) {
        toast.error('Backfill fehlgeschlagen: ' + (e as Error).message);
      } finally {
        setIsBackfilling(false);
      }
    };

    const runMonthlyAnalysis = async () => {
      setIsMonthlyRunning(true);
      try {
        const { error } = await supabase.functions.invoke('analyze-patterns', {
          body: { type: 'monthly_pattern' },
        });
        if (error) throw error;
        toast.success('Monatsanalyse gestartet');
      } catch (e) {
        toast.error('Monatsanalyse fehlgeschlagen: ' + (e as Error).message);
      } finally {
        setIsMonthlyRunning(false);
      }
    };

    const AutomationBox = ({
      enabledKey, timeKey, extra, description, lastRunAt,
    }: {
      enabledKey: keyof HeatingSettings;
      timeKey: keyof HeatingSettings;
      extra?: React.ReactNode;
      description?: string;
      lastRunAt?: string | null;
    }) => {
      const enabled = Boolean(get(enabledKey));
      const time = String(get(timeKey) ?? '');
      return (
        <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
          {description && (
            <p className="text-[11px] text-muted-foreground leading-snug">{description}</p>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-xs font-medium">Automatisch</Label>
              <LastRunBadge iso={lastRunAt} />
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => set({ [enabledKey]: v } as Partial<HeatingSettings>)}
            />
          </div>
          {enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Uhrzeit</Label>
                <Input
                  type="time"
                  value={time?.slice(0, 5) || ''}
                  onChange={(e) => set({ [timeKey]: e.target.value } as Partial<HeatingSettings>)}
                  className="h-8"
                />
              </div>
              {extra}
            </div>
          )}
        </div>
      );
    };

    const dirty = Object.keys(draft).length > 0;

    return (
      <Card ref={ref}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            KI-Musteranalyse
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Datenpflege (Entwickler) — eingeklappt */}
          <Collapsible open={devOpen} onOpenChange={setDevOpen}>
            <div className="rounded-lg border bg-muted/20">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors rounded-t-lg"
                >
                  <Wrench className="w-4 h-4 text-muted-foreground" />
                  <span>🔧 Datenpflege (Entwickler)</span>
                  <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${devOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-3 pt-1 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
                      Tagesscores werden normalerweise automatisch berechnet. Starte einen Backfill nur, wenn historische Daten fehlen.
                    </p>
                    <LastRunBadge iso={lastRuns.scheduler_daily} />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                    <div className="space-y-1 flex-1">
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Label className="text-xs text-muted-foreground inline-flex items-center gap-1 cursor-help">
                              <Database className="w-3 h-3" /> Zeitraum
                              <Info className="w-3 h-3" />
                            </Label>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Für wie viele Tage in der Vergangenheit sollen die KI-Bewertungsscores neu berechnet werden?
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Select
                        value={String(backfillDays)}
                        onValueChange={(v) => setBackfillDays(parseInt(v, 10))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7">Letzte 7 Tage</SelectItem>
                          <SelectItem value="30">Letzte 30 Tage</SelectItem>
                          <SelectItem value="90">Letzte 90 Tage</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={runBackfill} disabled={isBackfilling} variant="secondary">
                      {isBackfilling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                      Scores jetzt neu berechnen
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <Tabs defaultValue="daily" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="daily" className="text-xs sm:text-sm">
                <TrendingUp className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Tag</span>
              </TabsTrigger>
              <TabsTrigger value="weekly" className="text-xs sm:text-sm">
                <Calendar className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Woche</span>
              </TabsTrigger>
              <TabsTrigger value="monthly" className="text-xs sm:text-sm">
                <CalendarDays className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Monat</span>
              </TabsTrigger>
              <TabsTrigger value="yearly" className="text-xs sm:text-sm">
                <LineChart className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Jahr</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="daily" className="space-y-2 mt-3">
              <ProgressCockpit range="day" />
              <Button
                variant="outline"
                onClick={() => onAnalyzeDaily(readings)}
                disabled={isAnalyzing || readings.length < 10}
                className="w-full sm:w-auto"
              >
                {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
                Tagesanalyse jetzt starten
              </Button>
              <AutomationBox
                enabledKey="analysis_daily_enabled"
                timeKey="analysis_daily_time"
                description="Die KI analysiert täglich dein Verbrauchsmuster und erkennt Abweichungen."
                lastRunAt={lastRuns.scheduler_daily}
              />
            </TabsContent>

            <TabsContent value="weekly" className="space-y-2 mt-3">
              <ProgressCockpit range="week" />
              <Button
                variant="outline"
                onClick={onAnalyzeWeekly}
                disabled={isAnalyzing}
                className="w-full sm:w-auto"
              >
                {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}
                Wochenvergleich jetzt starten
              </Button>
              <AutomationBox
                enabledKey="analysis_weekly_enabled"
                timeKey="analysis_weekly_time"
                description="Wöchentlicher Vergleich: Hat diese Woche mehr oder weniger PV-Ertrag gebracht als die Vorwoche?"
                lastRunAt={lastRuns.scheduler_weekly}
                extra={
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Wochentag</Label>
                    <Select
                      value={String(get('analysis_weekly_weekday') ?? 0)}
                      onValueChange={(v) => set({ analysis_weekly_weekday: parseInt(v, 10) })}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WEEKDAYS.map((d, i) => (
                          <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                }
              />
            </TabsContent>

            <TabsContent value="monthly" className="space-y-2 mt-3">
              <ProgressCockpit range="month" />
              <Button
                variant="outline"
                onClick={runMonthlyAnalysis}
                disabled={isMonthlyRunning}
                className="w-full sm:w-auto"
              >
                {isMonthlyRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarDays className="w-4 h-4 mr-2" />}
                Monatsanalyse jetzt starten
              </Button>
              <AutomationBox
                enabledKey="analysis_monthly_enabled"
                timeKey="analysis_monthly_time"
                description="Die KI berechnet monatlich Langzeit-Trends und passt die Heizstrategie für die kommende Jahreszeit an."
                lastRunAt={lastRuns.scheduler_monthly}
                extra={
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Tag im Monat (1–28)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={Number(get('analysis_monthly_dom') ?? 1)}
                      onChange={(e) => set({ analysis_monthly_dom: Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)) })}
                      className="h-8"
                    />
                  </div>
                }
              />
            </TabsContent>

            <TabsContent value="yearly" className="space-y-2 mt-3">
              <YearTrendChart />
            </TabsContent>
          </Tabs>

          {dirty && (
            <div className="flex justify-end">
              <Button size="sm" onClick={persist}>
                <Save className="w-4 h-4 mr-2" />
                Automatik-Einstellungen speichern
              </Button>
            </div>
          )}

          {analysis && (
            <div className={cn('p-4 rounded-lg border bg-card', 'prose prose-sm dark:prose-invert max-w-none')}>
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{analysis}</div>
              </div>
            </div>
          )}

          {!analysis && !isAnalyzing && (
            <div className="text-center py-6 text-muted-foreground">
              <Brain className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Wähle einen Zeitraum-Tab und starte die Analyse oder aktiviere Automatik.</p>
            </div>
          )}

          {isAnalyzing && (
            <div className="text-center py-6 text-muted-foreground">
              <Loader2 className="w-10 h-10 mx-auto mb-2 animate-spin text-primary" />
              <p className="text-sm">Analysiere Energiedaten...</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
);

AnalysisPanel.displayName = 'AnalysisPanel';
