import { useCallback } from 'react';

/**
 * No-op since the app no longer registers a service worker.
 * Kept as a stable export so existing imports keep compiling.
 * The published site always loads fresh index.html, so an in-app
 * update banner is unnecessary.
 */
export const useServiceWorkerUpdate = () => {
  const updateApp = useCallback(() => {
    window.location.reload();
  }, []);

  const dismissUpdate = useCallback(() => {}, []);

  return {
    showUpdatePrompt: false as const,
    updateApp,
    dismissUpdate,
  };
};
