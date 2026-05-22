import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Stats {
  autoParamCount: number;
  totalEnabled: number;
  lastRunAt: string | null;
  autoAppliedToday: number;
  avgScore7d: number | null;
}

export function AIAutopilotToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = async () => {
    const [{ data: setting }, { data: wl }, { data: lastDec }, { data: todayDec }, { data: weekDec }] =
      await Promise.all([
        supabase.from('system_settings').select('value').eq('key', 'ai_auto_mode_enabled').maybeSingle(),
        supabase.from('ai_parameter_whitelist').select('autonomy_level, enabled').eq('enabled', true),
        supabase
          .from('ai_parameter_decisions')
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('ai_parameter_decisions')
          .select('id')
          .eq('auto_applied', true)
          .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
        supabase
          .from('ai_parameter_decisions')
          .select('outcome_score')
          .not('outcome_score', 'is', null)
          .gte('created_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
      ]);

    const val = (setting?.value as { enabled?: boolean } | null)?.enabled;
    setEnabled(val ?? true);

    const autoParamCount = (wl ?? []).filter((w: { autonomy_level: string }) => w.autonomy_level === 'auto').length;
    const scores = (weekDec ?? []).map((d: { outcome_score: number | null }) => d.outcome_score!).filter((n) => Number.isFinite(n));
    const avgScore7d = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    setStats({
      autoParamCount,
      totalEnabled: (wl ?? []).length,
      lastRunAt: lastDec?.[0]?.created_at ?? null,
      autoAppliedToday: (todayDec ?? []).length,
      avgScore7d,
    });
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const persist = async (newVal: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: 'ai_auto_mode_enabled', value: { enabled: newVal } as never }, { onConflict: 'key' });
    setSaving(false);
    if (error) {
      toast.error(`Speichern fehlgeschlagen: ${error.message}`);
      return;
    }
    setEnabled(newVal);
    toast.success(newVal ? 'KI-Autopilot aktiviert' : 'KI-Autopilot pausiert');
    load();
  };

  const handleToggle = (newVal: boolean) => {
    if (!newVal) {
      setConfirmOff(true);
      return;
    }
    persist(true);
  };

  const scoreColor =
    stats?.avgScore7d == null
      ? 'text-muted-foreground'
      : stats.avgScore7d > 0.2
      ? 'text-green-600'
      : stats.avgScore7d < -0.2
      ? 'text-destructive'
      : 'text-muted-foreground';

  return (
    <>
      <Card className={enabled ? 'border-primary/40 bg-primary/5' : 'border-muted'}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${enabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">KI-Autopilot</span>
                  {enabled === null ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : enabled ? (
                    <Badge className="bg-green-600">Aktiv</Badge>
                  ) : (
                    <Badge variant="secondary">Pausiert</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-prose">
                  Bei <strong>Aktiv</strong> läuft die KI-Analyse automatisch alle 15 Minuten und wendet Parameter mit
                  Autonomie-Stufe <code>auto</code> ohne Klick an. Schatten- und Vorschlag-Parameter bleiben unberührt.
                </p>
                {stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Auto-Parameter</div>
                      <div className="font-semibold">
                        {stats.autoParamCount} / {stats.totalEnabled}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Letzter Lauf</div>
                      <div className="font-semibold">
                        {stats.lastRunAt
                          ? formatDistanceToNow(new Date(stats.lastRunAt), { locale: de, addSuffix: true })
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Auto heute</div>
                      <div className="font-semibold">{stats.autoAppliedToday}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Ø Score 7T</div>
                      <div className={`font-semibold ${scoreColor}`}>
                        {stats.avgScore7d != null ? stats.avgScore7d.toFixed(2) : '—'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <Switch
              checked={!!enabled}
              onCheckedChange={handleToggle}
              disabled={saving || enabled === null}
              aria-label="KI-Autopilot umschalten"
            />
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>KI-Autopilot pausieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Bereits angewendete Parameter-Änderungen bleiben aktiv. Neue Vorschläge werden nur noch als „Schatten"
              dokumentiert und nicht automatisch übernommen. Du kannst den Autopiloten jederzeit wieder aktivieren.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOff(false);
                persist(false);
              }}
            >
              Pausieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
