import { useEffect, useState, useMemo, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, RefreshCw, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { AIDailyPlanCard } from './AIDailyPlanCard';
import { AIAutopilotToggle } from './AIAutopilotToggle';

type AutonomyLevel = 'shadow' | 'suggest' | 'auto';

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
  applied_at: string | null;
  applied_by: string | null;
  auto_applied: boolean | null;
  rollback_at: string | null;
}

interface WhitelistRow {
  id: string;
  parameter_key: string;
  scope: 'global' | 'room';
  storage_table: string;
  storage_column: string;
  data_type: 'number' | 'integer' | 'boolean' | 'text';
  min_value: number | null;
  max_value: number | null;
  allowed_values: string[] | null;
  autonomy_level: AutonomyLevel;
  enabled: boolean;
}

interface RoomLite { id: string; name: string }

function parseValue(raw: string, type: WhitelistRow['data_type']): number | string | boolean | null {
  if (type === 'boolean') return raw === 'true';
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    if (Number.isNaN(n)) return null;
    return type === 'integer' ? Math.round(n) : n;
  }
  return raw;
}

function validate(raw: string, wl: WhitelistRow): { ok: true; value: number | string | boolean } | { ok: false; error: string } {
  const v = parseValue(raw, wl.data_type);
  if (v === null) return { ok: false, error: `Ungültiger Wert für ${wl.data_type}` };
  if (wl.data_type === 'number' || wl.data_type === 'integer') {
    const n = v as number;
    if (wl.min_value != null && n < wl.min_value) return { ok: false, error: `Wert ${n} < min ${wl.min_value}` };
    if (wl.max_value != null && n > wl.max_value) return { ok: false, error: `Wert ${n} > max ${wl.max_value}` };
  }
  if (wl.allowed_values && wl.allowed_values.length > 0) {
    const cmp = String(v);
    if (!wl.allowed_values.map(String).includes(cmp)) {
      return { ok: false, error: `Wert nicht erlaubt: ${cmp}` };
    }
  }
  return { ok: true, value: v };
}

export function AIShadowDecisions() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [rooms, setRooms] = useState<RoomLite[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<{ at: string; ok: boolean; message: string } | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'unevaluated' | 'evaluated'>('all');
  const [paramFilter, setParamFilter] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: dec }, { data: rs }, { data: wl }] = await Promise.all([
      supabase.from('ai_parameter_decisions').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('rooms').select('id, name'),
      supabase.from('ai_parameter_whitelist').select('*').eq('enabled', true),
    ]);
    setDecisions((dec ?? []) as Decision[]);
    setRooms((rs ?? []) as RoomLite[]);
    setWhitelist((wl ?? []) as WhitelistRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const wlByKey = useMemo(() => {
    const m = new Map<string, WhitelistRow>();
    for (const w of whitelist) m.set(`${w.scope}:${w.parameter_key}`, w);
    return m;
  }, [whitelist]);

  const triggerRun = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke('ai-parameter-advisor');
    setRunning(false);
    const nowIso = new Date().toISOString();
    if (error) {
      const body = (error as { context?: { body?: unknown } })?.context?.body;
      const msg = (typeof body === 'object' && body && 'message' in body)
        ? String((body as { message: unknown }).message)
        : error.message;
      setLastRun({ at: nowIso, ok: false, message: msg });
      toast.error(`KI-Analyse fehlgeschlagen: ${msg}`);
      return;
    }
    if (data?.ok === false) {
      const msg = data?.message ?? data?.error ?? 'Unbekannter Fehler';
      setLastRun({ at: nowIso, ok: false, message: msg });
      toast.error(`KI-Analyse fehlgeschlagen: ${msg}`);
      return;
    }
    const accepted = data?.accepted ?? 0;
    const rejected = data?.rejected ?? 0;
    const autoApplied = data?.auto_applied ?? 0;
    const autoDetails = data?.auto_applied_details ?? [];
    let okMsg: string;
    if (autoApplied > 0) {
      okMsg = `${autoApplied} Parameter automatisch angewendet: ${autoDetails.map((a: any) => a.parameter_key).join(', ')} · ${accepted - autoApplied} weitere gespeichert`;
    } else if (accepted > 0) {
      okMsg = `${accepted} Vorschläge gespeichert (${rejected} verworfen)`;
    } else {
      okMsg = 'Keine Verbesserungen vorgeschlagen — System läuft im Sweet-Spot.';
    }
    setLastRun({ at: nowIso, ok: true, message: okMsg });
    toast.success(`KI-Analyse: ${okMsg}`);
    load();
  };

  const applyDecision = async (d: Decision) => {
    const wl = wlByKey.get(`${d.parameter_scope}:${d.parameter_key}`);
    if (!wl) {
      toast.error(`Kein Whitelist-Eintrag für ${d.parameter_key}`);
      return;
    }
    const v = validate(d.proposed_value, wl);
    if (v.ok === false) {
      toast.error(`Validierung fehlgeschlagen: ${v.error}`);
      return;
    }

    setApplying(d.id);
    try {
      if (wl.storage_table === 'rooms') {
        if (!d.room_id) throw new Error('Raum-ID fehlt');
        const { error } = await supabase.from('rooms').update({ [wl.storage_column]: v.value }).eq('id', d.room_id);
        if (error) throw error;
      } else if (wl.storage_table === 'heating_settings') {
        const { data: s, error: se } = await supabase.from('heating_settings').select('id').limit(1).single();
        if (se || !s) throw se ?? new Error('heating_settings nicht gefunden');
        const { error } = await supabase.from('heating_settings').update({ [wl.storage_column]: v.value }).eq('id', s.id);
        if (error) throw error;
      } else if (wl.storage_table === 'system_settings') {
        // key/value jsonb store
        const { error } = await supabase
          .from('system_settings')
          .upsert({ key: wl.storage_column, value: v.value as never }, { onConflict: 'key' });
        if (error) throw error;
      } else {
        throw new Error(`Unbekannte storage_table: ${wl.storage_table}`);
      }

      const { error: ue } = await supabase
        .from('ai_parameter_decisions')
        .update({ applied_at: new Date().toISOString(), applied_by: 'user' })
        .eq('id', d.id);
      if (ue) throw ue;

      toast.success(`${d.parameter_key} → ${d.proposed_value} übernommen`);
      load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Übernahme fehlgeschlagen: ${msg}`);
    } finally {
      setApplying(null);
    }
  };

  const setAutonomy = async (wl: WhitelistRow, level: AutonomyLevel) => {
    const { error } = await supabase
      .from('ai_parameter_whitelist')
      .update({ autonomy_level: level })
      .eq('id', wl.id);
    if (error) {
      toast.error(`Autonomie-Update fehlgeschlagen: ${error.message}`);
      return;
    }
    toast.success(`${wl.parameter_key}: Autonomie = ${level}`);
    load();
  };

  const filtered = decisions.filter((d) => {
    if (paramFilter && d.parameter_key !== paramFilter) return false;
    if (filter === 'unevaluated') return !d.outcome_evaluated_at;
    if (filter === 'evaluated') return !!d.outcome_evaluated_at;
    return true;
  });

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allExpanded = expanded.size === filtered.length && filtered.length > 0;
  const expandAll = () => {
    if (allExpanded) setExpanded(new Set());
    else setExpanded(new Set(filtered.map((d) => d.id)));
  };

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

  const statusCell = (d: Decision) => {
    if (d.applied_at) {
      return <Badge className="bg-green-600 gap-1"><Check className="h-3 w-3" />Übernommen</Badge>;
    }
    if (d.auto_applied) {
      return <Badge className="bg-emerald-600 gap-1"><Check className="h-3 w-3" />Auto</Badge>;
    }
    const wl = wlByKey.get(`${d.parameter_scope}:${d.parameter_key}`);
    if (!wl) return <Badge variant="outline">unbekannt</Badge>;
    if (wl.autonomy_level === 'shadow') return <Badge variant="secondary">Schatten</Badge>;
    if (wl.autonomy_level === 'auto') return <Badge className="bg-blue-600">Auto</Badge>;
    return <Badge variant="outline">Vorschlag</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              KI-Autopilot · Parameter-Vorschläge
            </CardTitle>
            <CardDescription>
              Der KI-Autopilot analysiert das System alle 15 Minuten, schlägt Parameter-Änderungen vor und
              wendet sie – je nach Modus – automatisch an oder erst nach deiner Freigabe.
            </CardDescription>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                Legende anzeigen
              </summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 rounded-md border bg-muted/30 p-3">
                <div>
                  <div className="font-medium mb-1.5">Filter (oben rechts)</div>
                  <ul className="space-y-1 text-muted-foreground">
                    <li><strong className="text-foreground">Alle</strong> – jeder gespeicherte Vorschlag der letzten Tage</li>
                    <li><strong className="text-foreground">Offen</strong> – noch nicht bewertet (Outcome-Score fehlt)</li>
                    <li><strong className="text-foreground">Bewertet</strong> – Outcome nach ~60 min gemessen. Score positiv = hat geholfen, negativ = hat geschadet (→ ggf. Auto-Rollback)</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium mb-1.5">Modus pro Parameter</div>
                  <ul className="space-y-1.5 text-muted-foreground">
                    <li className="flex gap-2"><Badge variant="secondary" className="shrink-0">Schatten</Badge><span>KI loggt nur, ändert nichts. Lernphase.</span></li>
                    <li className="flex gap-2"><Badge variant="outline" className="shrink-0">Vorschlag</Badge><span>KI speichert Vorschlag, du klickst „Anwenden".</span></li>
                    <li className="flex gap-2"><Badge className="bg-blue-600 shrink-0">Auto</Badge><span>KI wendet selbst an (wenn Autopilot-Master aktiv); bei Score &lt; −0.3 automatischer Rollback.</span></li>
                  </ul>
                </div>
              </div>
            </details>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {(['all', 'unevaluated', 'evaluated'] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Alle' : f === 'unevaluated' ? 'Offen' : 'Bewertet'}
              </Button>
            ))}
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
        <AIAutopilotToggle />
        <AIDailyPlanCard />



        {byParam.size > 0 && (
          <div className="flex flex-wrap gap-2">
            {Array.from(byParam.entries()).map(([k, v]) => {
              const active = paramFilter === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setParamFilter(active ? null : k)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/30 hover:bg-muted'
                  }`}
                >
                  <span className="font-mono">{k}</span>{' '}
                  <span className={active ? 'opacity-80' : 'text-muted-foreground'}>×{v.total}</span>
                  {v.evaluated > 0 && v.avgScore != null && (
                    <span className="ml-1">· Ø {v.avgScore.toFixed(2)}</span>
                  )}
                </button>
              );
            })}
            {paramFilter && (
              <button
                type="button"
                onClick={() => setParamFilter(null)}
                className="text-xs px-2 py-1 rounded border border-dashed hover:bg-muted"
              >
                ✕ Filter aufheben
              </button>
            )}
          </div>
        )}





        {filtered.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{filtered.length} Vorschläge</span>
            <Button variant="ghost" size="sm" onClick={expandAll}>
              {allExpanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              {allExpanded ? 'Alle zuklappen' : 'Alle aufklappen'}
            </Button>
          </div>
        )}

        {lastRun && (
          <div className={`text-sm rounded border px-3 py-2 ${lastRun.ok ? 'bg-muted/30 border-border' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
            <span className="font-medium">
              {lastRun.ok ? '✓ Letzte Analyse' : '⚠ Letzte Analyse fehlgeschlagen'}
            </span>{' '}
            <span className="text-muted-foreground">
              ({formatDistanceToNow(new Date(lastRun.at), { locale: de, addSuffix: true })})
            </span>
            <div className="mt-1">{lastRun.message}</div>
            {!lastRun.ok && (
              <div className="text-xs text-muted-foreground mt-1">
                Cron läuft stündlich — nächster automatischer Versuch zur vollen Stunde.
              </div>
            )}
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {lastRun?.ok === false
              ? 'Keine KI-Vorschläge verfügbar — siehe Fehlermeldung oben.'
              : 'Noch keine KI-Vorschläge. Klick auf „Jetzt analysieren" um zu starten.'}
          </p>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden space-y-2">
              {filtered.map((d) => {
                const wl = wlByKey.get(`${d.parameter_scope}:${d.parameter_key}`);
                const canApply = wl && wl.autonomy_level === 'suggest' && !d.applied_at;
                const isOpen = expanded.has(d.id);
                return (
                  <div
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleExpanded(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpanded(d.id);
                      }
                    }}
                    className="rounded-lg border bg-card p-3 active:bg-muted/50 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-mono text-xs break-all">{d.parameter_key}</div>
                      <div className="shrink-0 flex items-center gap-1">
                        {statusCell(d)}
                        {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>
                    <div className="mt-1.5 text-sm">
                      <span className="text-muted-foreground">{d.current_value ?? '—'}</span>
                      {' → '}
                      <span className="font-semibold">{d.proposed_value}</span>
                      {d.confidence != null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({Math.round(d.confidence * 100)}%)
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {roomName(d.room_id)} · {formatDistanceToNow(new Date(d.created_at), { addSuffix: true, locale: de })}
                      </span>
                      {scoreBadge(d.outcome_score)}
                    </div>
                    {isOpen && (
                      <div
                        className="mt-3 pt-3 border-t text-xs space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div><strong>Begründung:</strong> {d.reasoning ?? '—'}</div>
                        {d.expected_outcome && (
                          <div className="break-all"><strong>Erwartet:</strong> <code>{JSON.stringify(d.expected_outcome)}</code></div>
                        )}
                        {wl && (
                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                            <span className="text-muted-foreground">Autonomie:</span>
                            <Select
                              value={wl.autonomy_level}
                              onValueChange={(v) => setAutonomy(wl, v as AutonomyLevel)}
                            >
                              <SelectTrigger className="h-8 w-32 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="shadow">Schatten</SelectItem>
                                <SelectItem value="suggest">Vorschlag</SelectItem>
                                <SelectItem value="auto">Auto</SelectItem>
                              </SelectContent>
                            </Select>
                            <span className="text-muted-foreground">
                              Range: {wl.min_value ?? '–'} … {wl.max_value ?? '–'}
                              {wl.allowed_values ? ` · ${wl.allowed_values.join('/')}` : ''}
                            </span>
                          </div>
                        )}
                        {canApply && (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => applyDecision(d)}
                            disabled={applying === d.id}
                          >
                            {applying === d.id ? '…' : 'Übernehmen'}
                          </Button>
                        )}
                        {d.auto_applied && (
                          <div className="text-emerald-700 dark:text-emerald-400">
                            ✅ Automatisch angewendet durch KI
                          </div>
                        )}
                        {d.applied_at && (
                          <div className="text-green-700 dark:text-green-400">
                            Übernommen am {new Date(d.applied_at).toLocaleString('de-DE')} ({d.applied_by ?? 'unbekannt'})
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wann</TableHead>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Raum</TableHead>
                  <TableHead>Aktuell → Vorschlag</TableHead>
                  <TableHead>Konfidenz</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const wl = wlByKey.get(`${d.parameter_scope}:${d.parameter_key}`);
                  const canApply = wl && wl.autonomy_level === 'suggest' && !d.applied_at;
                  return (
                    <Fragment key={d.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => toggleExpanded(d.id)}
                      >
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
                        <TableCell>{statusCell(d)}</TableCell>
                        <TableCell>{scoreBadge(d.outcome_score)}</TableCell>
                        <TableCell className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          {canApply && (
                            <Button
                              size="sm"
                              onClick={() => applyDecision(d)}
                              disabled={applying === d.id}
                            >
                              {applying === d.id ? '…' : 'Übernehmen'}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(d.id); }}
                          >
                            {expanded.has(d.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded.has(d.id) && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/20">
                            <div className="text-xs space-y-2 py-2">
                              <div><strong>Begründung:</strong> {d.reasoning ?? '—'}</div>
                              {d.expected_outcome && (
                                <div><strong>Erwartet:</strong> <code>{JSON.stringify(d.expected_outcome)}</code></div>
                              )}
                              {wl && (
                                <div className="flex items-center gap-2 pt-2 border-t">
                                  <span className="text-muted-foreground">Autonomie für <code>{wl.parameter_key}</code>:</span>
                                  <Select
                                    value={wl.autonomy_level}
                                    onValueChange={(v) => setAutonomy(wl, v as AutonomyLevel)}
                                  >
                                    <SelectTrigger className="h-7 w-32 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="shadow">Schatten</SelectItem>
                                      <SelectItem value="suggest">Vorschlag</SelectItem>
                              <SelectItem value="auto">Auto</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <span className="text-muted-foreground">
                                    Range: {wl.min_value ?? '–'} … {wl.max_value ?? '–'}
                                    {wl.allowed_values ? ` · ${wl.allowed_values.join('/')}` : ''}
                                  </span>
                                </div>
                              )}
                              {d.auto_applied && (
                                <div className="text-emerald-700 dark:text-emerald-400">
                                  ✅ Automatisch angewendet durch KI · Kill-Switch: system_settings.ai_auto_mode_enabled
                                </div>
                              )}
                              {d.applied_at && (
                                <div className="text-green-700 dark:text-green-400">
                                  Übernommen am {new Date(d.applied_at).toLocaleString('de-DE')} ({d.applied_by ?? 'unbekannt'})
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
