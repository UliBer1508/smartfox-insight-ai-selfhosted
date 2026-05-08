import { Zap, Settings, BarChart3, Moon, Sun, Thermometer, Download, WifiOff, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { ControlModeBadge } from '@/components/layout/ControlModeBadge';

interface HeaderProps {
  activeTab: 'dashboard' | 'settings' | 'analysis' | 'heating';
  onTabChange: (tab: 'dashboard' | 'settings' | 'analysis' | 'heating') => void;
}

const tabs = [
  { key: 'dashboard' as const, icon: BarChart3, label: 'Dashboard' },
  { key: 'heating' as const, icon: Thermometer, label: 'Heizung' },
  { key: 'analysis' as const, icon: Zap, label: 'Analyse' },
  { key: 'settings' as const, icon: Settings, label: 'Einstellungen' },
];

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const [isDark, setIsDark] = useState(false);
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
  const { isOnline, getOfflineMinutes } = useOnlineStatus();
  const { signOut } = useAuth();
  const isMobile = useIsMobile();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const handleInstall = async () => {
    await promptInstall();
  };

  const offlineMinutes = getOfflineMinutes();

  return (
    <>
      {/* Top Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50 safe-area-top">
        <div className="w-full max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              <div className="p-1.5 md:p-2 rounded-lg bg-primary/10 energy-glow flex-shrink-0">
                <Zap className="w-5 h-5 md:w-6 md:h-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base md:text-xl font-bold tracking-tight truncate">Fronius Smart AI</h1>
                <p className="text-[10px] md:text-xs text-muted-foreground hidden sm:block">
                  Energie-Management & KI-Analyse
                  {typeof __BUILD_TIME__ !== 'undefined' && (
                    <span className="ml-2 opacity-60">
                      · Build {new Date(__BUILD_TIME__).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </p>
              </div>
              {!isOnline && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] flex-shrink-0">
                  <WifiOff className="w-3 h-3" />
                  <span>Offline{offlineMinutes ? ` (${offlineMinutes}m)` : ''}</span>
                </div>
              )}
            </div>

            {/* Desktop: full nav | Mobile: only actions */}
            <nav className="flex items-center gap-1 md:gap-2">
              {!isMobile && tabs.map(tab => (
                <Button
                  key={tab.key}
                  variant={activeTab === tab.key ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => onTabChange(tab.key)}
                >
                  <tab.icon className="w-4 h-4 mr-2" />
                  {tab.label}
                </Button>
              ))}

              <ControlModeBadge onClick={() => onTabChange('settings')} />

              {!isMobile && <div className="w-px h-6 bg-border mx-1" />}

              {isInstallable && !isInstalled && (
                <Button variant="outline" size="sm" onClick={handleInstall} className="gap-1.5">
                  <Download className="w-4 h-4" />
                  <span className="hidden md:inline">Installieren</span>
                </Button>
              )}
              
              <Button variant="ghost" size="icon" onClick={() => setIsDark(!isDark)} className="h-8 w-8 md:h-9 md:w-9">
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              
              <Button variant="ghost" size="icon" onClick={signOut} title="Abmelden" className="h-8 w-8 md:h-9 md:w-9">
                <LogOut className="w-4 h-4" />
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Tab Bar */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t bottom-tab-bar">
          <div className="flex items-stretch justify-around">
            {tabs.map(tab => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => onTabChange(tab.key)}
                  className={`flex flex-col items-center justify-center flex-1 py-2 gap-0.5 transition-colors touch-manipulation ${
                    isActive 
                      ? 'text-primary' 
                      : 'text-muted-foreground'
                  }`}
                >
                  <tab.icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                  <span className="text-[10px] font-medium leading-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
