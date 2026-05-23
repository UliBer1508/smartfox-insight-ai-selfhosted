import { cn } from '@/lib/utils';
import { Bot } from 'lucide-react';

interface AIBadgeProps {
  active: boolean;
  label?: string;
  className?: string;
}

/**
 * Einheitliches Badge das anzeigt ob ein KI-Feature aktiv ist.
 * Aktiv: grün mit pulsierendem Punkt.
 * Inaktiv: grau ohne Animation.
 */
export function AIBadge({ active, label = 'KI', className }: AIBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium',
        active
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-muted text-muted-foreground border-border',
        className,
      )}
      title={active ? 'KI-Steuerung aktiv' : 'KI-Steuerung inaktiv'}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          active ? 'bg-primary animate-pulse' : 'bg-muted-foreground/50',
        )}
      />
      <Bot className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
