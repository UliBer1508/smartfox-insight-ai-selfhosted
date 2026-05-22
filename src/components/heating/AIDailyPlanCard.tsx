import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CalendarClock, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface PlanRoom {
  room_id?: string;
  room_name: string;
  priority_rank: number;
  recommended_temp: number;
  reasoning: string;
}

interface TimeBlock {
  start_time: string;
  end_time: string;
  strategy: string;
}

interface DailyPlan {
  id: string;
  plan_date: string;
  source: string;
  overall_strategy: string | null;
  time_blocks: TimeBlock[];
  rooms: PlanRoom[];
  created_at: string;
}

function todayVienna(): string {
  const v = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
  return v.toISOString().slice(0, 10);
}

export function AIDailyPlanCard() {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ai_daily_plans')
      .select('*')
      .eq('plan_date', todayVienna())
      .maybeSingle();
    if (error) console.error('load plan', error);
    setPlan((data as unknown) as DailyPlan | null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const generateNow = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-daily-planner', { body: {} });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? 'Plan-Generierung fehlgeschlagen');
      toast.success('Tagesplan erstellt');
      await load();
    } catch (e: any) {
      toast.error(`Fehler: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return null;

  if (!plan) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4" />
          Heute noch kein KI-Tagesplan — läuft täglich um 06:00.
        </div>
        <Button size="sm" variant="outline" onClick={generateNow} disabled={generating}>
          <Sparkles className="h-4 w-4 mr-1.5" />
          {generating ? 'Erzeuge …' : 'Jetzt erzeugen'}
        </Button>
      </div>
    );
  }

  const rooms = (plan.rooms ?? []).slice().sort((a, b) => (a.priority_rank ?? 99) - (b.priority_rank ?? 99));
  const strategy = plan.overall_strategy ?? '';
  const longStrategy = strategy.length > 220;
  const visibleStrategy = expanded || !longStrategy ? strategy : strategy.slice(0, 220) + '…';

  return (
    <div className="rounded-lg border bg-primary/5 border-primary/20 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Tagesplan KI · {plan.plan_date}</span>
          <Badge variant={plan.source === 'claude-haiku' ? 'default' : 'secondary'} className="text-[10px]">
            {plan.source === 'claude-haiku' ? 'Claude' : plan.source === 'gemini-flash-fallback' ? 'Gemini (Fallback)' : plan.source}
          </Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={generateNow} disabled={generating}>
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          {generating ? 'Neu …' : 'Neu erzeugen'}
        </Button>
      </div>

      {strategy && (
        <div className="text-sm text-foreground/90 leading-relaxed">
          {visibleStrategy}
          {longStrategy && (
            <button
              type="button"
              className="ml-1 text-primary inline-flex items-center gap-0.5 text-xs hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <>weniger <ChevronUp className="h-3 w-3" /></> : <>mehr <ChevronDown className="h-3 w-3" /></>}
            </button>
          )}
        </div>
      )}

      {plan.time_blocks?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plan.time_blocks.map((tb, i) => (
            <div key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-background border">
              <span className="font-mono">{tb.start_time}–{tb.end_time}</span>
              <span className="text-muted-foreground mx-1">·</span>
              <span>{tb.strategy}</span>
            </div>
          ))}
        </div>
      )}

      {rooms.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="text-left py-1 pr-2">Rang</th>
                <th className="text-left py-1 pr-2">Raum</th>
                <th className="text-left py-1 pr-2">Ziel</th>
                <th className="text-left py-1">Warum</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r, i) => (
                <tr key={(r.room_id ?? r.room_name) + i} className="border-b last:border-0">
                  <td className="py-1 pr-2 font-semibold">#{r.priority_rank}</td>
                  <td className="py-1 pr-2">{r.room_name}</td>
                  <td className="py-1 pr-2 font-mono">{Number(r.recommended_temp).toFixed(1)}°C</td>
                  <td className="py-1 text-muted-foreground">{r.reasoning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
