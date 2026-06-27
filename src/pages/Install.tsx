import { usePWAInstall } from '@/hooks/usePWAInstall';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Download, Smartphone, Share, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SEO } from '@/components/SEO';

const Install = () => {
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const navigate = useNavigate();

  const handleInstall = async () => {
    const success = await promptInstall();
    if (success) {
      navigate('/');
    }
  };

  return (
    <div className="flex-1 bg-background flex items-center justify-center p-4">
      <SEO
        title="App installieren — Steinbockchalets-Heizungsmanagement"
        description="Installieren Sie Steinbockchalets-Heizungsmanagement PWA auf Ihrem Smartphone oder Tablet für schnellen Zugriff auf Ihr Energie-Management."
        path="/install"
      />
      <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-24 h-24 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <svg viewBox="0 0 100 100" className="w-16 h-16 text-white">
              <path
                fill="currentColor"
                d="M50 10 L65 40 L95 45 L72 68 L78 98 L50 83 L22 98 L28 68 L5 45 L35 40 Z"
              />
              <circle cx="50" cy="55" r="15" fill="currentColor" opacity="0.3" />
            </svg>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold text-foreground">
              Smartfox Energy Pipeline
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-2">
              App auf deinem Gerät installieren
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {isInstalled ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="text-foreground font-medium">App ist bereits installiert!</p>
              <Button onClick={() => navigate('/')} className="w-full">
                Zur App
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Schneller Zugriff vom Homescreen</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Funktioniert offline</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Keine App Store Installation nötig</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span>Automatische Updates</span>
                </div>
              </div>

              {isInstallable ? (
                <Button 
                  onClick={handleInstall} 
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  size="lg"
                >
                  <Download className="w-5 h-5 mr-2" />
                  App installieren
                </Button>
              ) : (
                <div className="space-y-4">
                  <div className="h-px bg-border" />
                  
                  {isIOS ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-foreground flex items-center gap-2">
                        <Smartphone className="w-4 h-4" />
                        iOS Installation:
                      </p>
                      <ol className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">1</span>
                          <span className="flex items-center gap-1">
                            Tippe auf <Share className="w-4 h-4 inline" /> (Teilen)
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">2</span>
                          <span className="flex items-center gap-1">
                            Wähle <Plus className="w-4 h-4 inline" /> "Zum Home-Bildschirm"
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">3</span>
                          <span>Tippe auf "Hinzufügen"</span>
                        </li>
                      </ol>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-foreground flex items-center gap-2">
                        <Smartphone className="w-4 h-4" />
                        Installation:
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Öffne diese Seite in Chrome oder Edge und tippe auf das 
                        Installieren-Symbol in der Adressleiste.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <Button 
                variant="ghost" 
                onClick={() => navigate('/')} 
                className="w-full text-muted-foreground"
              >
                Später installieren
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Install;
