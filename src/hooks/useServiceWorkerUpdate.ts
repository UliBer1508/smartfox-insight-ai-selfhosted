import { useState, useEffect, useCallback, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const useServiceWorkerUpdate = () => {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      console.log('SW registered:', swUrl);
      registrationRef.current = r || null;
      
      if (r) {
        // Check for updates every 5 minutes (instead of 1 hour)
        setInterval(() => {
          r.update();
        }, 5 * 60 * 1000);
        
        // Initial check after 10 seconds
        setTimeout(() => r.update(), 10 * 1000);
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
        registrationRef.current.update();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
