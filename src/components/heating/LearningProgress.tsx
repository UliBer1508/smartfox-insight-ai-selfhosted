import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, ChevronDown, Sparkles, Flame, Snowflake, Zap, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface RoomMLFeatures {
  room_id: string;
  date: string;
  heat_loss_rate_deg_per_hour: number | null;
  heating_rate_deg_per_hour: number | null;
  energy_per_degree_wh: number | null;
  solar_gain_factor: number | null;
  pv_heating_ratio: number | null;
  confidence: number;
  sample_count: number;
}

interface LearningEvent {
  id: string;
  timestamp: string;
  decision_type: string;
  room_id: string | null;
  reward: number | null;
  is_evaluated: boolean;
}

interface RoomInfo {
  id: string;
  name: string;
  current_temp?: number | null;
  target_temp?: number | null;
  tuya_device_id?: string | null;
}

interface ThermostatDecision {
  room_id: string;
  room_name: string;
  action: 'activate' | 'deactivate' | 'keep';
  target_temp: number;
  reasoning: string;
  confidence?: number;
  priority?: string;
}

interface AnalysisResult {
  decisions: ThermostatDecision[];
  overall_strategy: string;
  expected_total_savings_wh?: number;
}

interface LearningProgressProps {
  autoRunAnalysis?: boolean;
}

export function LearningProgress({ autoRunAnalysis = false }: LearningProgressProps) {
  const [features, setFeatures] = useState<RoomMLFeatures[]>([]);
  const [recentEvents, setRecentEvents] = useState<LearningEvent[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  // Auto-run analysis when enabled and rooms are loaded
  useEffect(() => {
    if (autoRunAnalysis && rooms.length > 0 && !analysisResult && !isAnalyzing && !isLoading) {
      const tuyaRooms = rooms.filter(r => r.tuya_device_id);
      if (tuyaRooms.length > 0) {
        runAnalysis();
      }
    }
  }, [autoRunAnalysis, rooms, analysisResult, isAnalyzing, isLoading]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const [featuresResult, eventsResult, roomsResult] = await Promise.all([
        supabase
          .from('room_ml_features')
          .select('*')
          .eq('date', today),
        supabase
          .from('learning_events')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(5),
        supabase
          .from('rooms')
          .select('id, name, current_temp, target_temp, tuya_device_id')
      ]);

      setFeatures((featuresResult.data || []) as RoomMLFeatures[]);
      setRecentEvents((eventsResult.data || []) as LearningEvent[]);
      setRooms((roomsResult.data || []) as RoomInfo[]);
    } catch (error) {
      console.error('Error loading learning data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const extractFeatures = async () => {
    setIsExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ml-feature-extraction', {
        body: {}
      });

      if (error) throw error;

      toast.success(`Features für ${data.results?.length || 0} Räume berechnet`);
      loadData();
    } catch (error) {
      console.error('Feature extraction error:', error);
      toast.error('Fehler bei Feature-Berechnung');
    } finally {
      setIsExtracting(false);
    }
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch all required data
      const [readingsResult, settingsResult, mlFeaturesResult, rewardsResult] = await Promise.all([
        supabase
          .from('energy_readings')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(1),
        supabase
          .from('heating_settings')
          .select('*')
          .limit(1)
          .single(),
        supabase
          .from('room_ml_features')
          .select('*')
          .eq('date', today),
        supabase
          .from('learning_events')
          .select('*')
          .eq('is_evaluated', true)
          .order('timestamp', { ascending: false })
          .limit(10)
      ]);

      const currentReading = readingsResult.data?.[0];
      const heatingSettings = settingsResult.data;
      const mlFeatures = mlFeaturesResult.data || [];
      const recentRewards = rewardsResult.data || [];

      if (!currentReading) {
        toast.error('Keine aktuellen Energiedaten verfügbar');
        return;
      }

      // Call analyze-patterns with optimize_decision type
      const { data, error } = await supabase.functions.invoke('analyze-patterns', {
        body: {
          readings: [currentReading],
          heatingSettings: heatingSettings,
          rooms: rooms,
          mlFeatures: mlFeatures,
          recentRewards: recentRewards,
          type: 'optimize_decision'
        }
      });

      if (error) throw error;

      if (data?.decisions) {
        // Map room names to decisions
        const decisionsWithNames = data.decisions.map((d: any) => ({
          ...d,
          room_name: d.room_name || rooms.find(r => r.id === d.room_id)?.name || 'Unbekannt'
        }));

        setAnalysisResult({
          decisions: decisionsWithNames,
          overall_strategy: data.overall_strategy || 'Optimale Heizstrategie basierend auf aktueller Energiesituation',
          expected_total_savings_wh: data.expected_total_savings_wh
        });
        
        toast.success('KI-Analyse abgeschlossen');
      } else {
        toast.error('Keine Empfehlungen erhalten');
      }
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Fehler bei KI-Analyse');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getRoomName = (roomId: string | null) => {
    if (!roomId) return 'Global';
    const room = rooms.find(r => r.id === roomId);
    return room?.name || 'Unbekannt';
  };

  const getRewardIcon = (reward: number | null) => {
    if (reward === null) return <Minus className="h-3 w-3 text-muted-foreground" />;
    if (reward > 0.5) return <TrendingUp className="h-3 w-3 text-green-500" />;
    if (reward < -0.2) return <TrendingDown className="h-3 w-3 text-red-500" />;
    return <Minus className="h-3 w-3 text-yellow-500" />;
  };

  const getActionIcon = (action: string, priority?: string) => {
    if (action === 'activate' || priority === 'heat_now') {
      return <Flame className="h-4 w-4 text-orange-500" />;
    }
    if (action === 'deactivate' || priority === 'off' || priority === 'reduce') {
      return <Snowflake className="h-4 w-4 text-cyan-500" />;
    }
    return <Zap className="h-4 w-4 text-blue-500" />;
  };

  const getActionLabel = (action: string, priority?: string) => {
    if (action === 'activate' || priority === 'heat_now') return 'Heizen';
    if (action === 'deactivate' || priority === 'off') return 'Aus';
    if (priority === 'reduce') return 'Reduzieren';
    if (priority === 'preheat') return 'Vorheizen';
    return 'Halten';
  };

  const getActionBadgeVariant = (action: string, priority?: string): 'default' | 'secondary' | 'outline' | 'destructive' => {
    if (action === 'activate' || priority === 'heat_now' || priority === 'preheat') return 'default';
    if (action === 'deactivate' || priority === 'off' || priority === 'reduce') return 'secondary';
    return 'outline';
  };

  const totalSamples = features.reduce((sum, f) => sum + (f.sample_count || 0), 0);
  const avgConfidence = features.length > 0 
    ? features.reduce((sum, f) => sum + (f.confidence || 0), 0) / features.length 
    : 0;
  const evaluatedEvents = recentEvents.filter(e => e.is_evaluated);
  const avgReward = evaluatedEvents.length > 0
    ? evaluatedEvents.reduce((sum, e) => sum + (e.reward || 0), 0) / evaluatedEvents.length
    : null;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const hasData = features.length > 0 || recentEvents.length > 0;
  const tuyaRooms = rooms.filter(r => r.tuya_device_id);

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">ML-Status</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {/* Compact stats */}
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  <span className="font-mono font-medium text-foreground">{totalSamples}</span> Samples
                </span>
                <span className="text-muted-foreground">
                  <span className="font-mono font-medium text-foreground">{Math.round(avgConfidence * 100)}%</span> Conf
                </span>
                <span className="text-muted-foreground">
                  <span className={`font-mono font-medium ${avgReward !== null && avgReward > 0 ? 'text-green-500' : avgReward !== null && avgReward < 0 ? 'text-red-500' : 'text-foreground'}`}>
                    {avgReward !== null ? (avgReward > 0 ? '+' : '') + avgReward.toFixed(2) : '—'}
                  </span> Ø
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 w-7 p-0"
                onClick={extractFeatures}
                disabled={isExtracting}
              >
                {isExtracting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </Button>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* KI Analysis Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  KI-Empfehlungen
                </h4>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs"
                  onClick={runAnalysis}
                  disabled={isAnalyzing || tuyaRooms.length === 0}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Analysiere...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 mr-1" />
                      Analyse starten
                    </>
                  )}
                </Button>
              </div>

              {analysisResult ? (
                <div className="space-y-2">
                  {/* Thermostat Recommendations - direkt anzeigen */}
                  {analysisResult.decisions.map((decision, idx) => (
                    <div 
                      key={decision.room_id || idx} 
                      className="flex items-center justify-between bg-muted/30 rounded-lg p-2 border border-border/50"
                    >
                      <div className="flex items-center gap-2">
                        {getActionIcon(decision.action, decision.priority)}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm">{decision.room_name}</span>
                            <Badge 
                              variant={getActionBadgeVariant(decision.action, decision.priority)}
                              className="text-[10px] px-1 h-4"
                            >
                              {getActionLabel(decision.action, decision.priority)}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                            {decision.reasoning}
                          </p>
                        </div>
                      </div>
                      <span className="text-xl font-bold text-foreground ml-2">
                        {decision.target_temp}°
                      </span>
                    </div>
                  ))}
                  
                  {analysisResult.expected_total_savings_wh && analysisResult.expected_total_savings_wh > 0 && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      💡 ~{Math.round(analysisResult.expected_total_savings_wh)} Wh Einsparung
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-center text-muted-foreground py-2">
                  {tuyaRooms.length === 0 
                    ? 'Keine Tuya-Thermostate' 
                    : isAnalyzing ? 'Analysiere...' : 'Klicke "Analyse starten"'}
                </p>
              )}
            </div>

            {/* Separator */}
            <div className="border-t border-border/50" />

            {/* Recent decisions - compact */}
            {recentEvents.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-muted-foreground">Letzte Entscheidungen</h4>
                <div className="flex flex-wrap gap-1">
                  {recentEvents.slice(0, 3).map((event) => (
                    <div 
                      key={event.id} 
                      className="flex items-center gap-1 text-xs bg-muted/50 rounded px-2 py-1"
                    >
                      {getRewardIcon(event.reward)}
                      <span className="text-muted-foreground">
                        {new Date(event.timestamp).toLocaleTimeString('de-DE', { 
                          hour: '2-digit', 
                          minute: '2-digit',
                          timeZone: 'Europe/Berlin'
                        })}
                      </span>
                      <span className="truncate max-w-[80px]">{getRoomName(event.room_id)}</span>
                      {event.is_evaluated && event.reward !== null && (
                        <Badge variant={event.reward > 0 ? 'default' : 'secondary'} className="text-[10px] px-1 h-4">
                          {event.reward > 0 ? '+' : ''}{event.reward.toFixed(1)}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Room features - compact list */}
            {features.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-muted-foreground">Gelernte Features</h4>
                <div className="grid grid-cols-2 gap-1">
                  {features.slice(0, 4).map((f) => (
                    <div key={f.room_id} className="flex items-center justify-between text-xs bg-muted/30 rounded px-2 py-1">
                      <span className="truncate max-w-[80px]">{getRoomName(f.room_id)}</span>
                      <Badge variant={f.confidence > 0.7 ? 'default' : 'outline'} className="text-[10px] px-1 h-4">
                        {Math.round(f.confidence * 100)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!hasData && !analysisResult && (
              <div className="text-center text-muted-foreground py-2">
                <p className="text-xs">Noch keine Lerndaten. Das System lernt automatisch.</p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
