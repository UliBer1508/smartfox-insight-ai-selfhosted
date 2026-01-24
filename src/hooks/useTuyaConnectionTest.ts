import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TuyaTestResult {
  credentials_configured: boolean;
  token_valid: boolean;
  token_error: string | null;
  api_accessible: boolean;
  api_error: string | null;
  quota_exhausted: boolean;
  error_code: string | null;
  error_message: string | null;
  devices_count: number;
  tested_at: string;
}

export function useTuyaConnectionTest() {
  const [result, setResult] = useState<TuyaTestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('tuya-control/test', {
        body: {},
      });

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      if (data) {
        setResult(data as TuyaTestResult);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getTimeSinceTest = useCallback(() => {
    if (!result?.tested_at) return null;
    
    const diff = Date.now() - new Date(result.tested_at).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes < 1) return `vor ${seconds} Sekunden`;
    if (minutes < 60) return `vor ${minutes} Minuten`;
    return `vor mehr als einer Stunde`;
  }, [result?.tested_at]);

  return {
    result,
    isLoading,
    error,
    runTest,
    getTimeSinceTest,
  };
}
