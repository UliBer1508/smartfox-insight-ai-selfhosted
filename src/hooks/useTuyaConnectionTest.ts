import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface RegionResult {
  name: string;
  url: string;
  region: string;
  success: boolean;
  error?: string;
  error_code?: string;
  quota_exhausted?: boolean;
}

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
  current_region: string;
  region_results: RegionResult[];
  working_regions: string[];
}

export function useTuyaConnectionTest() {
  const [result, setResult] = useState<TuyaTestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSettingRegion, setIsSettingRegion] = useState(false);

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

  const setRegion = useCallback(async (url: string, region: string) => {
    setIsSettingRegion(true);
    setError(null);
    
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('tuya-control/set-region', {
        body: { url, region },
      });

      if (invokeError) {
        throw new Error(invokeError.message);
      }

      // Re-run test after changing region
      await runTest();
      return data;
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setIsSettingRegion(false);
    }
  }, [runTest]);

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
    setRegion,
    isSettingRegion,
    getTimeSinceTest,
  };
}
