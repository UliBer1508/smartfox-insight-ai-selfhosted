import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export const PWARegistration = () => {
  const { needRefresh } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      console.log('✅ Service Worker registriert:', swUrl);
      
      if (r) {
        // Regelmäßige Update-Checks alle 5 Minuten
        setInterval(() => r.update(), 5 * 60 * 1000);
        // Erster Check nach 10 Sekunden
        setTimeout(() => r.update(), 10 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('❌ SW Registrierung fehlgeschlagen:', error);
    },
  });

  useEffect(() => {
    const [refresh] = needRefresh || [];
    if (refresh) {
      console.log('🔄 Neue PWA-Version verfügbar');
    }
  }, [needRefresh]);

  // Render nichts, nur für Side-Effects
  return null;
};
