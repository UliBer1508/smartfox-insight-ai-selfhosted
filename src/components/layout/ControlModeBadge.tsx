import { Cloud, Network } from 'lucide-react';
import { useControlMode } from '@/hooks/useControlMode';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ControlModeBadgeProps {
  onClick?: () => void;
  className?: string;
}

export function ControlModeBadge({ onClick, className }: ControlModeBadgeProps) {
  const { mode, isLoading } = useControlMode();
  if (isLoading) return null;

  const isLocal = mode === 'local';
  const Icon = isLocal ? Network : Cloud;
  const label = isLocal ? 'Lokal' : 'Cloud';
  const tooltip = isLocal
    ? 'Steuerungsmodus: Lokaler Service (LAN, Port 6668)'
    : 'Steuerungsmodus: Tuya Cloud API';

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium border transition-colors flex-shrink-0',
              isLocal
                ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
                : 'bg-muted text-muted-foreground border-border hover:bg-muted/70',
              className,
            )}
            aria-label={tooltip}
          >
            <Icon className="w-3 h-3" />
            <span>{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
