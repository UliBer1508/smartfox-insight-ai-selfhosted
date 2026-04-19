import { cn } from '@/lib/utils';
import { Wifi, WifiOff, RefreshCw, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

interface ConnectionStatusProps {
  isConnected: boolean;
  lastUpdate?: string;
  error?: string | null;
  onRefresh: () => void;
}

export function ConnectionStatus({ 
  isConnected, 
  lastUpdate, 
  error,
  onRefresh 
}: ConnectionStatusProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-4 px-4 py-2 rounded-lg bg-card border">
      <div className={cn(
        'flex items-center gap-2 px-3 py-1 rounded-full text-sm',
        isConnected 
          ? 'bg-success/20 text-success' 
          : 'bg-destructive/20 text-destructive'
      )}>
        {isConnected ? (
          <Wifi className="w-4 h-4" />
        ) : (
          <WifiOff className="w-4 h-4" />
        )}
        {isConnected ? 'Verbunden' : 'Keine aktuellen Daten'}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Server className="w-4 h-4" />
        Collector-Modus
      </div>

      {lastUpdate && (
        <div className="text-sm text-muted-foreground">
          {new Date(lastUpdate).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin' })} ({formatDistanceToNow(new Date(lastUpdate), { addSuffix: true, locale: de })})
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive">
          Fehler: {error}
        </div>
      )}

      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onRefresh}
        className="ml-auto"
        title="Daten neu laden"
      >
        <RefreshCw className="w-4 h-4" />
      </Button>
    </div>
  );
}
