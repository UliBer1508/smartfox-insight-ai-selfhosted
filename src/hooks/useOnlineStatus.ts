import { useState, useEffect } from 'react';

export const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastOnline, setLastOnline] = useState<Date | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastOnline(null);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastOnline(new Date());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const getOfflineMinutes = (): number | null => {
    if (!lastOnline) return null;
    return Math.floor((Date.now() - lastOnline.getTime()) / 60000);
  };

  return {
    isOnline,
    lastOnline,
    getOfflineMinutes,
  };
};
