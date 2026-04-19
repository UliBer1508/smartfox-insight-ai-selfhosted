import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * PWA update flow.
 *
 * Strategy: vite-plugin-pwa is configured with `registerType: 'autoUpdate'` +
 * `skipWaiting` + `clientsClaim`. That means a new SW takes over automatically
 * on next load. We additionally surface a visible "reload now" banner whenever
 * a new SW activates while the user is currently in the app, so they get the
 * fresh UI without having to manually close/reopen the tab.
 *
 * In preview/iframe contexts (see src/main.tsx), no SW is registered at all,
 * so this hook becomes a no-op there.
 */
export const useServiceWorkerUpdate = () => {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const initialControllerRef = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Remember the SW that controlled the page at load time.
    initialControllerRef.current = navigator.serviceWorker.controller;

    const onControllerChange = () => {
      // A new SW has taken control. If we already had a controller before,
      // it means the app was upgraded in-place → prompt user to reload.
      if (initialControllerRef.current) {
        setShowUpdatePrompt(true);
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // Also poll for updates when tab becomes visible again.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.getRegistration().then((reg) => {
        reg?.update().catch(() => {});
      });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const updateApp = useCallback(() => {
    setShowUpdatePrompt(false);
    window.location.reload();
  }, []);

  const dismissUpdate = useCallback(() => {
    setShowUpdatePrompt(false);
  }, []);

  return {
    showUpdatePrompt,
    updateApp,
    dismissUpdate,
  };
};
