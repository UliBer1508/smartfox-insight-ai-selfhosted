import { Home, Zap, Settings, BarChart3, Moon, Sun, Brain, Download, WifiOff, LogOut, ScrollText, LineChart } from 'lucide-react';
import { useKiPending } from '@/hooks/useKiPending';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/hooks/useAuth';
import { ControlModeBadge } from '@/components/layout/ControlModeBadge';
import { SystemStatusButton } from '@/components/layout/SystemStatus';

// Tabs nach Zweck (seit 26.10.2026): ansehen · rückblicken · prüfen/entscheiden · einstellen
// + Protokoll (01.11.2026): was die Steuerung und die Thermostate tun – Test- und Protokoll-Modul
// + Auto-Steuerung (12.11.2026, ganz vorne – Uli: „vor Übersicht, da sie die Hauptsteuerungskomponente werden soll“)
export type AppTab = 'auto' | 'overview' | 'analysis' | 'ki' | 'protokoll' | 'settings';

interface HeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

const tabs = [
  { key: 'auto' as const, icon: LineChart, label: 'Auto-Steuerung' },
  { key: 'overview' as const, icon: Home, label: 'Übersicht' },
  { key: 'analysis' as const, icon: BarChart3, label: 'Analyse' },
  { key: 'ki' as const, icon: Brain, label: 'KI' },
  { key: 'protokoll' as const, icon: ScrollText, label: 'Protokoll' },
  { key: 'settings' as const, icon: Settings, label: 'Einstellungen' },
];

// Handy-Ansicht (Tabs unten) erst unter 640 px – wie Heizung München (12.11.2026).
// Vorher 768 px: in schmalen Desktop-Fenstern verschwanden die Tabs aus der Kopfleiste.
const HANDY_BREITE = 640;
function useHandy() {
  const [handy, setHandy] = useState(() => typeof window !== 'undefined' && window.innerWidth < HANDY_BREITE);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${HANDY_BREITE - 1}px)`);
    const onChange = () => setHandy(window.innerWidth < HANDY_BREITE);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return handy;
}

function PendingDot({ n, mobile }: { n: number; mobile?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      aria-label={`${n} offene KI-Vorschläge`}
      className={`${mobile ? 'absolute -top-0.5 -right-2.5' : 'ml-1.5'} inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-violet-600 text-white text-[10px] font-bold`}
    >{n}</span>
  );
}

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const [isDark, setIsDark] = useState(false);
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
  const { isOnline, getOfflineMinutes } = useOnlineStatus();
  const { signOut } = useAuth();
  const isMobile = useHandy();
  const pending = useKiPending();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const handleInstall = async () => {
    await promptInstall();
  };

  const offlineMinutes = getOfflineMinutes();

  return (
    <>
      {/* Top Header – aufgebaut wie Heizung München (12.11.2026): eine Zeile mit Logo, Name, Tabs als Pillen,
          rechts Systemstatus/Modus/Abmelden. Farben bleiben Venediger. Build-Zeit steht im Fuß und als Tooltip am Namen. */}
      <header className="border-b bg-background/90 backdrop-blur-sm sticky top-0 z-50 safe-area-top">
        <div className="w-full max-w-7xl mx-auto px-3 md:px-5 py-2.5 md:py-3 flex items-center gap-3 md:gap-4 min-w-0">
          <div
            className="flex items-center gap-2.5 min-w-0 flex-shrink-0"
            title={typeof __BUILD_TIME__ !== 'undefined'
              ? `Build ${new Date(__BUILD_TIME__).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}`
              : undefined}
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Zap className="w-[18px] h-[18px] text-primary" />
            </div>
            <h1 className="text-base md:text-lg font-semibold tracking-tight truncate">Heizung Venediger</h1>
          </div>

          {!isOnline && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[11px] flex-shrink-0">
              <WifiOff className="w-3 h-3" />
              <span>Offline{offlineMinutes ? ` (${offlineMinutes}m)` : ''}</span>
            </div>
          )}

          {/* Tabs (Desktop) – Mobile nutzt die Leiste unten */}
          {!isMobile ? (
            <nav className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto" role="tablist">
              {tabs.map(tab => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onTabChange(tab.key)}
                    className={`inline-flex items-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors touch-manipulation ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                    }`}
                  >
                    {tab.label}
                    {tab.key === 'ki' && <PendingDot n={pending.total} />}
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="flex-1" />
          )}

          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            {/* Systemstatus: laufen alle Prozesse? (05.11.2026, doc/SYSTEMSTATUS-2026-11-05.md) */}
            <SystemStatusButton compact={isMobile} />
            <ControlModeBadge onClick={() => onTabChange('settings')} />
            {isInstallable && !isInstalled && (
              <Button variant="outline" size={isMobile ? 'icon' : 'sm'} onClick={handleInstall} className={isMobile ? 'h-8 w-8' : 'gap-1.5'}>
                <Download className="w-4 h-4" />
                {!isMobile && <span>Installieren</span>}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setIsDark(!isDark)} className="h-8 w-8 md:h-9 md:w-9" title={isDark ? 'Hell' : 'Dunkel'}>
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            {isMobile ? (
              <Button variant="ghost" size="icon" onClick={signOut} title="Abmelden" className="h-8 w-8">
                <LogOut className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={signOut} className="rounded-full">
                Abmelden
              </Button>
            )}
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
                  <span className="relative">
                    <tab.icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                    {tab.key === 'ki' && <PendingDot n={pending.total} mobile />}
                  </span>
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
