import { useState, useEffect, useCallback, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const useServiceWorkerUpdate = () => {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      console.log('SW registered:', swUrl);
      registrationRef.current = r || null;

      const checkForWaitingWorker = async () => {
        if (!r) return;

        try {
          await r.update();

          if (r.waiting) {
            setNeedRefresh(true);
            setShowUpdatePrompt(true);
          }
        } catch (error) {
          console.error('SW update check failed:', error);
        }
      };
      
      if (r) {
        intervalRef.current = window.setInterval(checkForWaitingWorker, 5 * 60 * 1000);
        timeoutRef.current = window.setTimeout(checkForWaitingWorker, 10 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error);
    },
  });

  // Check for updates when app becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && registrationRef.current) {
        registrationRef.current.update().then(() => {
          if (registrationRef.current?.waiting) {
            setNeedRefresh(true);
            setShowUpdatePrompt(true);
          }
        }).catch((error) => {
          console.error('SW visibility update check failed:', error);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
      }

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (needRefresh) {
      setShowUpdatePrompt(true);
    }
  }, [needRefresh]);

  const updateApp = useCallback(() => {
    updateServiceWorker(true);
    setShowUpdatePrompt(false);
  }, [updateServiceWorker]);

  const dismissUpdate = useCallback(() => {
    setShowUpdatePrompt(false);
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  return {
    showUpdatePrompt,
    updateApp,
    dismissUpdate,
  };
};
