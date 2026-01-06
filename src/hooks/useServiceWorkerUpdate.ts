import { useState, useEffect, useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const useServiceWorkerUpdate = () => {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      console.log('SW registered:', swUrl);
      // Check for updates every hour
      if (r) {
        setInterval(() => {
          r.update();
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error);
    },
  });

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
