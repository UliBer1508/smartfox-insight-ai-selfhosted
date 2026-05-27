import React, { useEffect, useState } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  iso: string | null | undefined;
  /** Alter ab dem der Badge auf "veraltet" (amber) schaltet, in ms. */
  staleAfterMs?: number;
  /** Vorgesetzter Label-Text, default: "Zuletzt". */
  label?: string;
  className?: string;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unbekannt';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'gleich';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'gerade eben';
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `vor ${hr} h`;

  const tz = 'Europe/Vienna';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const that = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - 86400000));
  const time = new Intl.DateTimeFormat('de-AT', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  if (that === yesterday) return `gestern ${time}`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `vor ${days} Tagen`;
  if (today === that) return `heute ${time}`;
  const date = new Intl.DateTimeFormat('de-AT', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(d);
  return date;
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export const LastUpdatedBadge: React.FC<Props> = ({ iso, staleAfterMs, label = 'Zuletzt', className }) => {
  // Auto-tick alle 60 s, damit "vor X min/h" live wandert
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, [iso]);

  const hasIso = !!iso;
  const ageMs = hasIso ? Date.now() - new Date(iso!).getTime() : Infinity;
  const isStale = hasIso && staleAfterMs !== undefined && ageMs > staleAfterMs;

  const tone = !hasIso
    ? 'border-muted bg-muted/40 text-muted-foreground'
    : isStale
      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
      : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';

  const Icon = isStale ? AlertCircle : Clock;
  const text = hasIso ? formatRelative(iso!) : 'noch nicht gelaufen';

  const badge = (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap',
      tone,
      className,
    )}>
      <Icon className="w-3 h-3" />
      {label}: {text}
    </span>
  );

  if (!hasIso) return badge;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {formatAbsolute(iso!)} (Europe/Vienna)
          {isStale && staleAfterMs !== undefined && (
            <div className="text-amber-600 dark:text-amber-400 mt-0.5">
              Älter als erwartet – Auto-Refresh prüfen.
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
