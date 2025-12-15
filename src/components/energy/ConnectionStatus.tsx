import { cn } from '@/lib/utils';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface ConnectionStatusProps {
  isConnected: boolean;
  isPolling: boolean;
  lastUpdate?: string;
  error?: string | null;
  onRefresh: () => void;
}

export function ConnectionStatus({ 
  isConnected, 
  isPolling, 
  lastUpdate, 
  error,
  onRefresh 
}: ConnectionStatusProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 rounded-lg bg-card border">
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
        {isConnected ? 'Verbunden' : 'Getrennt'}
      </div>

      {isPolling && (
        <div className="flex items-center gap-2 text-sm text-primary">
          <RefreshCw className="w-4 h-4 animate-spin-slow" />
          Erfassung aktiv
        </div>
      )}

      {lastUpdate && (
        <div className="text-sm text-muted-foreground">
          Letzte Aktualisierung: {format(new Date(lastUpdate), 'HH:mm:ss', { locale: de })}
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
      >
        <RefreshCw className="w-4 h-4" />
      </Button>
    </div>
  );
}
