import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, Save, RefreshCw } from 'lucide-react';
import { useHeatingSettings } from '@/hooks/useHeatingSettings';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { HeatingSettings } from '@/types/heating';

interface BestMatch {
  computed_at?: string;
  match_quality?: 'exact' | 'partial' | 'weak' | 'none';
  top_days?: Array<{ date?: string; score?: number; kpi_pv_heating_coverage?: number }>;
}

const QUALITY_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  exact: 'default',
  partial: 'secondary',
  weak: 'outline',
  none: 'destructive',
};

const QUALITY_LABEL: Record<string, string> = {
  exact: 'Exakt',
  partial: 'Teilweise',
  weak: 'Schwach',
  none: 'Kein Match',
};

export function PatternRecallBlock() {
  const { settings, saveSettings } = useHeatingSettings();
  const [draft, setDraft] = useState<Partial<HeatingSettings>>({});
  const [match, setMatch] = useState<BestMatch | null>(null);
  const [isMatching, setIsMatching] = useState(false);

  const get = <K extends keyof HeatingSettings>(k: K): HeatingSettings[K] =>
    (draft[k] !== undefined ? draft[k] : settings[k]) as HeatingSettings[K];
  const set = (patch: Partial<HeatingSettings>) =>
    setDraft((d) => ({ ...d, ...patch }));
  const dirty = Object.keys(draft).length > 0;

  const loadMatch = async () => {
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'best_match_today')
      .maybeSingle();
    setMatch((data?.value as BestMatch) ?? null);
  };

  useEffect(() => {
    loadMatch();
    const id = setInterval(loadMatch, 60_000);
    return () => clearInterval(id);
  }, []);

  const persist = async () => {
    if (!dirty) return;
    await saveSettings(draft);
    setDraft({});
  };

  const matchNow = async () => {
    setIsMatching(true);
    try {
      const { error } = await supabase.functions.invoke('analyze-patterns', {
        body: { type: 'match_today' },
      });
      if (error) throw error;
      toast.success('Pattern-Match aktualisiert');
      await loadMatch();
    } catch (e) {
      toast.error('Match fehlgeschlagen: ' + (e as Error).message);
    } finally {
      setIsMatching(false);
    }
  };

  const enabled = Boolean(get('analysis_match_today_enabled'));
  const time = String(get('analysis_match_today_time') ?? '').slice(0, 5);
  const strength = Number(get('pattern_recall_strength') ?? 50);
  const quality = match?.match_quality ?? 'none';
  const winner = match?.top_days?.[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="w-4 h-4 text-primary" />
          Pattern-Recall
        </CardTitle>
        <CardDescription className="text-xs">
          Wendet Erkenntnisse aus den besten vergangenen Tagen mit ähnlichen PV/Wetter-Bedingungen an.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={QUALITY_VARIANT[quality]}>{QUALITY_LABEL[quality]}</Badge>
            {winner?.date && (
              <span className="text-xs text-muted-foreground">
                Winner: {winner.date} (Score {Math.round(Number(winner.score ?? 0))})
              </span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={matchNow} disabled={isMatching}>
            {isMatching ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Jetzt matchen
          </Button>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Pattern-Recall aktiv</Label>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => set({ analysis_match_today_enabled: v })}
            />
          </div>

          {enabled && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Tägliches Matching um</Label>
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => set({ analysis_match_today_time: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <Label className="text-muted-foreground">Stärke (Komfort-Bonus-Skalierung)</Label>
                  <span className="font-mono">{strength}%</span>
                </div>
                <Slider
                  value={[strength]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([v]) => set({ pattern_recall_strength: v })}
                />
                <p className="text-[11px] text-muted-foreground">
                  0% = aus, 100% = +400 W Komfort-Bonus bei exaktem Match (×0,6 bei partial).
                </p>
              </div>
            </>
          )}
        </div>

        {dirty && (
          <div className="flex justify-end">
            <Button size="sm" onClick={persist}>
              <Save className="w-4 h-4 mr-2" />
              Speichern
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
