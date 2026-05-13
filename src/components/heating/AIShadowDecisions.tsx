import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Brain, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

interface Decision {
  id: string;
  created_at: string;
  parameter_scope: 'global' | 'room';
  room_id: string | null;
  parameter_key: string;
  current_value: string | null;
  proposed_value: string;
  reasoning: string | null;
  confidence: number | null;
  expected_outcome: Record<string, unknown> | null;
  outcome_score: number | null;
  outcome_evaluated_at: string | null;
  decision_mode: string;
}

interface RoomLite { id: string; name: string }

export function AIShadowDecisions() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unevaluated' | 'evaluated'>('all');

  const load = async () => {
    setLoading(true);
    const [{ data: dec }, { data: rs }] = await Promise.all([
      supabase
        .from('ai_parameter_decisions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('rooms').select('id,name'),
    ]);
    setDecisions((dec ?? []) as Decision[]);
    setRooms((rs ?? []) as RoomLite[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const triggerRun = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke('ai-parameter-advisor');
    setRunning(false);
    if (error) {
      toast.error(`KI-Analyse fehlgeschlagen: ${error.message}`);
      return;
    }
    toast.success(`KI-Analyse: ${data?.accepted ?? 0} Vorschläge gespeichert (${data?.rejected ?? 0} verworfen)`);
    load();
  };

  const filtered = decisions.filter((d) => {
    if (filter === 'unevaluated') return !d.outcome_evaluated_at;
    if (filter === 'evaluated') return !!d.outcome_evaluated_at;
    return true;
  });

  // Aggregations
  const byParam = new Map<string, { total: number; avgScore: number | null; evaluated: number }>();
  for (const d of decisions) {
    const cur = byParam.get(d.parameter_key) ?? { total: 0, avgScore: null, evaluated: 0 };
    cur.total++;
    if (d.outcome_score != null) {
      cur.evaluated++;
      cur.avgScore = cur.avgScore == null ? d.outcome_score : (cur.avgScore + d.outcome_score) / 2;
    }
    byParam.set(d.parameter_key, cur);
  }

  const roomName = (id: string | null) => (id ? rooms.find((r) => r.id === id)?.name ?? id.slice(0, 8) : '—');

  const scoreBadge = (s: number | null) => {
    if (s == null) return <Badge variant="outline">offen</Badge>;
    if (s > 0.3) return <Badge className="bg-green-600">+{s.toFixed(2)}</Badge>;
    if (s < -0.3) return <Badge variant="destructive">{s.toFixed(2)}</Badge>;
    return <Badge variant="secondary">{s.toFixed(2)}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              KI-Schatten-Entscheidungen
            </CardTitle>
            <CardDescription>
              Die KI schlägt Parameter-Änderungen vor und protokolliert ihre Begründung.
              Es werden <strong>keine Werte geändert</strong> — Lernphase zur Bewertung.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={triggerRun} disabled={running}>
              {running ? 'KI denkt …' : 'Jetzt analysieren'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Per-parameter aggregation */}
        {byParam.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {Array.from(byParam.entries()).map(([k, v]) => (
              <div key={k} className="text-xs px-2 py-1 rounded border bg-muted/30">
                <span className="font-mono">{k}</span>{' '}
                <span className="text-muted-foreground">×{v.total}</span>
                {v.evaluated > 0 && v.avgScore != null && (
                  <span className="ml-1">· Ø {v.avgScore.toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Filter buttons */}
        <div className="flex gap-2">
          {(['all', 'unevaluated', 'evaluated'] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Alle' : f === 'unevaluated' ? 'Offen' : 'Bewertet'}
            </Button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Noch keine KI-Vorschläge. Klick auf „Jetzt analysieren" um zu starten.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wann</TableHead>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Raum</TableHead>
                  <TableHead>Aktuell → Vorschlag</TableHead>
                  <TableHead>Konfidenz</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <>
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">
                        {formatDistanceToNow(new Date(d.created_at), { addSuffix: true, locale: de })}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.parameter_key}</TableCell>
                      <TableCell className="text-xs">{roomName(d.room_id)}</TableCell>
                      <TableCell className="text-xs">
                        <span className="text-muted-foreground">{d.current_value ?? '—'}</span>
                        {' → '}
                        <span className="font-semibold">{d.proposed_value}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {d.confidence != null ? `${Math.round(d.confidence * 100)}%` : '—'}
                      </TableCell>
                      <TableCell>{scoreBadge(d.outcome_score)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                        >
                          {expanded === d.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded === d.id && (
                      <TableRow key={`${d.id}-exp`}>
                        <TableCell colSpan={7} className="bg-muted/20">
                          <div className="text-xs space-y-1 py-2">
                            <div><strong>Begründung:</strong> {d.reasoning ?? '—'}</div>
                            {d.expected_outcome && (
                              <div><strong>Erwartet:</strong> <code>{JSON.stringify(d.expected_outcome)}</code></div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
