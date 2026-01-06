import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AutomationStatus {
  roomId: string;
  name: string;
  automationEnabled: boolean;
  lastAutoChange: string | null;
  targetTemp: number | null;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  errors: number;
  details?: {
    applied: { roomId: string; name: string; oldTemp: number; newTemp: number; reason: string }[];
    skipped: { roomId: string; name: string; reason: string }[];
    errors: { roomId: string; name: string; error: string }[];
  };
}

export function useAutomation() {
  const [isApplying, setIsApplying] = useState(false);
  const [lastResult, setLastResult] = useState<ApplyResult | null>(null);

  const toggleAutomation = useCallback(async (roomId: string, enabled: boolean): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('apply-recommendations/toggle', {
        body: { roomId, enabled },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success(enabled ? 'Automatik aktiviert' : 'Automatik deaktiviert');
      return true;
    } catch (error) {
      console.error('Error toggling automation:', error);
      toast.error('Fehler beim Umschalten der Automatik');
      return false;
    }
  }, []);

  const applyRecommendations = useCallback(async (): Promise<ApplyResult | null> => {
    setIsApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke('apply-recommendations/apply', {
        body: {},
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      const result: ApplyResult = {
        applied: data.applied,
        skipped: data.skipped,
        errors: data.errors,
        details: data.details,
      };

      setLastResult(result);

      if (result.applied > 0) {
        toast.success(`${result.applied} Raum/Räume automatisch angepasst`);
      } else if (result.skipped > 0) {
        toast.info('Keine Änderungen notwendig');
      }

      if (result.errors > 0) {
        toast.error(`${result.errors} Fehler bei der Anpassung`);
      }

      return result;
    } catch (error) {
      console.error('Error applying recommendations:', error);
      toast.error('Fehler beim Anwenden der Empfehlungen');
      return null;
    } finally {
      setIsApplying(false);
    }
  }, []);

  const getStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('apply-recommendations/status', {
        body: {},
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting automation status:', error);
      return null;
    }
  }, []);

  return {
    isApplying,
    lastResult,
    toggleAutomation,
    applyRecommendations,
    getStatus,
  };
}
