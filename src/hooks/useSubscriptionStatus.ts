import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { differenceInDays, parseISO, format } from 'date-fns';
import { de } from 'date-fns/locale';

export type SubscriptionStatus = 'valid' | 'warning' | 'expired';

export interface SubscriptionData {
  expiresAt: string;
  warningDays: number;
}

export interface UseSubscriptionStatusReturn {
  expiresAt: string | null;
  warningDays: number;
  daysRemaining: number | null;
  status: SubscriptionStatus;
  formattedExpiry: string | null;
  isLoading: boolean;
  updateSettings: (data: Partial<SubscriptionData>) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const SESSION_STORAGE_KEY = 'tuya_subscription_warning_shown';

const getSessionFlag = (key: string): string | null =>
  typeof window !== 'undefined' ? sessionStorage.getItem(key) : null;

const setSessionFlag = (key: string, value: string): void => {
  if (typeof window !== 'undefined') sessionStorage.setItem(key, value);
};

export function useSubscriptionStatus(): UseSubscriptionStatusReturn {
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [warningDays, setWarningDays] = useState<number>(30);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_subscription')
        .single();

      if (error) {
        console.error('Error fetching subscription settings:', error);
        return;
      }

      if (data?.value) {
        const value = data.value as { expires_at?: string; warning_days?: number };
        setExpiresAt(value.expires_at || null);
        setWarningDays(value.warning_days || 30);
      }
    } catch (err) {
      console.error('Error in fetchSettings:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Calculate days remaining and status
  const daysRemaining = expiresAt 
    ? differenceInDays(parseISO(expiresAt), new Date())
    : null;

  const status: SubscriptionStatus = 
    daysRemaining === null ? 'valid' :
    daysRemaining <= 0 ? 'expired' :
    daysRemaining <= warningDays ? 'warning' : 'valid';

  const formattedExpiry = expiresAt 
    ? format(parseISO(expiresAt), 'dd. MMMM yyyy', { locale: de })
    : null;

  // Show toast warning on first load if status is warning or expired
  useEffect(() => {
    if (isLoading) return;
    
    const alreadyShown = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (alreadyShown) return;

    if (status === 'expired') {
      toast.error('Tuya Subscription abgelaufen!', {
        description: 'Bitte verlängern Sie unter iot.tuya.com',
        duration: 10000,
      });
      sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
    } else if (status === 'warning' && daysRemaining !== null) {
      toast.warning(`Tuya Subscription läuft in ${daysRemaining} Tagen ab!`, {
        description: 'Bitte rechtzeitig verlängern unter iot.tuya.com',
        duration: 8000,
      });
      sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
    }
  }, [isLoading, status, daysRemaining]);

  const updateSettings = useCallback(async (data: Partial<SubscriptionData>): Promise<boolean> => {
    try {
      // Get current value first
      const { data: current, error: fetchError } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'tuya_subscription')
        .single();

      if (fetchError) throw fetchError;

      const currentValue = current?.value as { expires_at?: string; warning_days?: number } || {};
      const newValue = {
        expires_at: data.expiresAt ?? currentValue.expires_at,
        warning_days: data.warningDays ?? currentValue.warning_days ?? 30,
      };

      const { error } = await supabase
        .from('system_settings')
        .update({ value: newValue })
        .eq('key', 'tuya_subscription');

      if (error) throw error;

      // Update local state
      if (data.expiresAt !== undefined) setExpiresAt(data.expiresAt);
      if (data.warningDays !== undefined) setWarningDays(data.warningDays);

      toast.success('Einstellungen gespeichert');
      return true;
    } catch (err) {
      console.error('Error updating subscription settings:', err);
      toast.error('Fehler beim Speichern');
      return false;
    }
  }, []);

  return {
    expiresAt,
    warningDays,
    daysRemaining,
    status,
    formattedExpiry,
    isLoading,
    updateSettings,
    refetch: fetchSettings,
  };
}
