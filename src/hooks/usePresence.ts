// Anwesenheit (Konzept 28.10.2026, doc/KONZEPT-ANWESENHEIT-2026-10-28.md)
// Kalender presence_periods = Zeiträume, in denen jemand im Haus ist. Außerhalb gilt abwesend.
// Gleiche Regel wie pv-automation/getPresence: "anwesend" beginnt presence_lead_hours vor start_at.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { HeatingSettings } from '@/types/heating';

export interface PresencePeriod {
  id: string;
  start_at: string;
  end_at: string;
  note: string | null;
  source: string;
}

export interface PresenceState {
  enabled: boolean;
  away: boolean;
  inLead: boolean;            // Vorlauf: Eintrag beginnt bald, gilt schon als anwesend
  until: string | null;       // anwesend bis
  next: PresencePeriod | null; // nächster Eintrag (bei Abwesenheit)
  current: PresencePeriod[];  // laufende Einträge (start_at ≤ jetzt)
}

export function computePresence(periods: PresencePeriod[], settings: Pick<HeatingSettings, 'presence_control_enabled' | 'presence_lead_hours'> | null, nowMs = Date.now()): PresenceState {
  const enabled = settings?.presence_control_enabled !== false;
  const leadH = Math.max(0, Math.min(72, Number(settings?.presence_lead_hours ?? 6) || 0));
  const open = periods
    .filter(p => new Date(p.end_at).getTime() > nowMs)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const current = open.filter(p => new Date(p.start_at).getTime() <= nowMs);
  const active = open.filter(p => new Date(p.start_at).getTime() - leadH * 3600_000 <= nowMs);
  if (!enabled) return { enabled, away: false, inLead: false, until: null, next: open[0] ?? null, current };
  if (active.length > 0) {
    const until = active.map(p => p.end_at).sort().slice(-1)[0];
    return { enabled, away: false, inLead: current.length === 0, until, next: null, current };
  }
  return { enabled, away: true, inLead: false, until: null, next: open[0] ?? null, current };
}

export function usePresence(settings: Pick<HeatingSettings, 'presence_control_enabled' | 'presence_lead_hours'> | null) {
  const [periods, setPeriods] = useState<PresencePeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [available, setAvailable] = useState(true); // false, solange SQL 07 noch nicht ausgeführt ist
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    // laufende und künftige Einträge + die letzten 30 Tage (zur Kontrolle)
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data, error } = await supabase
      .from('presence_periods')
      .select('id, start_at, end_at, note, source')
      .gt('end_at', since)
      .order('start_at', { ascending: true });
    if (error) {
      console.warn('[usePresence] presence_periods nicht lesbar:', error.message);
      setAvailable(false);
    } else {
      setAvailable(true);
      setPeriods((data ?? []) as PresencePeriod[]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { load(); setTick(t => t + 1); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useMemo(() => computePresence(periods, settings), [periods, settings, tick]);

  const add = useCallback(async (startIso: string, endIso: string, note: string | null, source: 'app' | 'quick' = 'app') => {
    if (new Date(endIso) <= new Date(startIso)) {
      toast({ title: 'Ungültiger Zeitraum', description: '„Bis“ muss nach „Von“ liegen.', variant: 'destructive' });
      return false;
    }
    const { error } = await supabase.from('presence_periods').insert({ start_at: startIso, end_at: endIso, note, source });
    if (error) {
      toast({ title: 'Speichern fehlgeschlagen', description: error.message, variant: 'destructive' });
      return false;
    }
    await load();
    return true;
  }, [load]);

  const update = useCallback(async (id: string, patch: Partial<Pick<PresencePeriod, 'start_at' | 'end_at' | 'note'>>) => {
    const { error } = await supabase.from('presence_periods')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      toast({ title: 'Speichern fehlgeschlagen', description: error.message, variant: 'destructive' });
      return false;
    }
    await load();
    return true;
  }, [load]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.from('presence_periods').delete().eq('id', id);
    if (error) {
      toast({ title: 'Löschen fehlgeschlagen', description: error.message, variant: 'destructive' });
      return false;
    }
    await load();
    return true;
  }, [load]);

  /** Schnellschalter „Ich bin da bis …“: neuer Eintrag ab jetzt. */
  const arriveUntil = useCallback(async (endIso: string) => {
    return add(new Date().toISOString(), endIso, 'Schnellschalter', 'quick');
  }, [add]);

  /** Schnellschalter „Ich bin weg“: laufende Einträge enden jetzt. Künftige bleiben stehen. */
  const leaveNow = useCallback(async () => {
    const now = Date.now();
    const running = periods.filter(p => new Date(p.start_at).getTime() < now && new Date(p.end_at).getTime() > now);
    for (const p of running) {
      const { error } = await supabase.from('presence_periods')
        .update({ end_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }).eq('id', p.id);
      if (error) {
        toast({ title: 'Speichern fehlgeschlagen', description: error.message, variant: 'destructive' });
        await load();
        return false;
      }
    }
    await load();
    return true;
  }, [periods, load]);

  return { periods, state, isLoading, available, add, update, remove, arriveUntil, leaveNow, reload: load };
}
