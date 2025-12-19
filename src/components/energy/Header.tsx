import { Zap, Settings, BarChart3, Moon, Sun, Thermometer, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';
import { usePWAInstall } from '@/hooks/usePWAInstall';

interface HeaderProps {
  activeTab: 'dashboard' | 'settings' | 'analysis' | 'heating';
  onTabChange: (tab: 'dashboard' | 'settings' | 'analysis' | 'heating') => void;
}

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const [isDark, setIsDark] = useState(false);
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const handleInstall = async () => {
    await promptInstall();
  };

  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 energy-glow">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Smartfox Energy</h1>
              <p className="text-xs text-muted-foreground">Pipeline & KI-Analyse</p>
            </div>
          </div>

          <nav className="flex items-center gap-1 md:gap-2 flex-wrap">
            <Button
              variant={activeTab === 'dashboard' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onTabChange('dashboard')}
            >
              <BarChart3 className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Dashboard</span>
            </Button>
            <Button
              variant={activeTab === 'heating' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onTabChange('heating')}
            >
              <Thermometer className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Heizung</span>
            </Button>
            <Button
              variant={activeTab === 'analysis' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onTabChange('analysis')}
            >
              <Zap className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Analyse</span>
            </Button>
            <Button
              variant={activeTab === 'settings' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onTabChange('settings')}
            >
              <Settings className="w-4 h-4 md:mr-2" />
              <span className="hidden md:inline">Einstellungen</span>
            </Button>

            <div className="w-px h-6 bg-border mx-2" />

            {isInstallable && !isInstalled && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleInstall}
                className="gap-1.5"
              >
                <Download className="w-4 h-4" />
                <span className="hidden md:inline">Installieren</span>
              </Button>
            )}
            
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDark(!isDark)}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
