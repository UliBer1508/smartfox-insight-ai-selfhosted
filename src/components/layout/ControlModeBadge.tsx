import { useEffect, useState } from 'react';
import { Cloud, Network, Ban } from 'lucide-react';
import { useControlMode } from '@/hooks/useControlMode';
import { supabase } from '@/integrations/supabase/client';
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
  const [cloudDisabled, setCloudDisabled] = useState(false);

  useEffect(() => {
    supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'tuya_cloud_status')
      .single()
      .then(({ data }) => {
        if (data?.value && (data.value as any).active === false) {
          setCloudDisabled(true);
        }
      });
  }, []);

  if (isLoading) return null;

  const isLocal = mode === 'local';
  const Icon = cloudDisabled ? Network : isLocal ? Network : Cloud;
  const label = cloudDisabled ? 'Cloud aus · Lokal' : isLocal ? 'Lokal' : 'Cloud';
  const tooltip = cloudDisabled
    ? 'Tuya Cloud ist deaktiviert — Steuerung läuft über lokalen Service (LAN, Port 6668)'
    : isLocal
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
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] md:text-xs font-medium border transition-colors flex-shrink-0',
              cloudDisabled
                ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200'
                : isLocal
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
