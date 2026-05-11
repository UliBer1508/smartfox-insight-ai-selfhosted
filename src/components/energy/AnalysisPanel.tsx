import React, { forwardRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EnergyReading } from '@/types/energy';
import { Brain, TrendingUp, Calendar, CalendarDays, Loader2, Database, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { HeatingSettings } from '@/types/heating';
import { ProgressCockpit } from './stats/ProgressCockpit';

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
      enabledKey, timeKey, extra,
    }: {
      enabledKey: keyof HeatingSettings;
      timeKey: keyof HeatingSettings;
      extra?: React.ReactNode;
    }) => {
      const enabled = Boolean(get(enabledKey));
      const time = String(get(timeKey) ?? '');
      return (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Automatisch ausführen</Label>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => set({ [enabledKey]: v } as Partial<HeatingSettings>)}
            />
          </div>
          {enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Uhrzeit</Label>
                <Input
                  type="time"
                  value={time?.slice(0, 5) || ''}
                  onChange={(e) => set({ [timeKey]: e.target.value } as Partial<HeatingSettings>)}
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            KI-Musteranalyse
          </CardTitle>
          <CardDescription>
            Automatische Erkennung von Verbrauchsmustern und Optimierungsvorschläge
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Backfill */}
          <div className="rounded-lg border bg-muted/20 p-3 flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="space-y-1 flex-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Database className="w-3 h-3" /> Tagesscores rückwirkend berechnen
              </Label>
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
              Backfill starten
            </Button>
          </div>

          <Tabs defaultValue="daily" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
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
            </TabsList>

            <TabsContent value="daily" className="space-y-3 mt-4">
              <Button
                variant="outline"
                onClick={() => onAnalyzeDaily(readings)}
                disabled={isAnalyzing || readings.length < 10}
                className="w-full sm:w-auto"
              >
                {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
                Tagesmuster jetzt analysieren
              </Button>
              <AutomationBox enabledKey="analysis_daily_enabled" timeKey="analysis_daily_time" />
            </TabsContent>

            <TabsContent value="weekly" className="space-y-3 mt-4">
              <Button
                variant="outline"
                onClick={onAnalyzeWeekly}
                disabled={isAnalyzing}
                className="w-full sm:w-auto"
              >
                {isAnalyzing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Calendar className="w-4 h-4 mr-2" />}
                Wochenvergleich jetzt
              </Button>
              <AutomationBox
                enabledKey="analysis_weekly_enabled"
                timeKey="analysis_weekly_time"
                extra={
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Wochentag</Label>
                    <Select
                      value={String(get('analysis_weekly_weekday') ?? 0)}
                      onValueChange={(v) => set({ analysis_weekly_weekday: parseInt(v, 10) })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
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

            <TabsContent value="monthly" className="space-y-3 mt-4">
              <Button
                variant="outline"
                onClick={runMonthlyAnalysis}
                disabled={isMonthlyRunning}
                className="w-full sm:w-auto"
              >
                {isMonthlyRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarDays className="w-4 h-4 mr-2" />}
                Monatsmuster jetzt
              </Button>
              <AutomationBox
                enabledKey="analysis_monthly_enabled"
                timeKey="analysis_monthly_time"
                extra={
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tag im Monat (1–28)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={Number(get('analysis_monthly_dom') ?? 1)}
                      onChange={(e) => set({ analysis_monthly_dom: Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)) })}
                    />
                  </div>
                }
              />
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
