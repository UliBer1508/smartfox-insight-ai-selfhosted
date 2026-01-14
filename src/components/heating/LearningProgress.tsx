import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, ChevronDown, Sparkles, Flame, Snowflake, Zap, CheckCircle2, Droplets, Clock, Moon, Sun, Thermometer, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getLocalDateString, getLocalMidnightISO } from '@/lib/dateUtils';

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

interface HotwaterRecommendation {
  enabled: boolean;
  recommended_start: string;
  recommended_end: string;
  min_surplus_w?: number;
  reasoning: string;
}

interface ThermostatPeriod {
  period: number;
  start_time: string;
  end_time: string;
  temperature: number;
  mode: 'comfort' | 'eco' | 'night' | 'off';
  reasoning?: string;
}

interface NightCyclingRecommendation {
  enabled: boolean;
  cycles_per_room: number;
  reasoning: string;
}

interface AnalysisResult {
  decisions: ThermostatDecision[];
  overall_strategy: string;
  expected_total_savings_wh?: number;
  hotwater_recommendation?: HotwaterRecommendation;
  thermostat_schedule?: ThermostatPeriod[];
  night_cycling?: NightCyclingRecommendation;
}

interface HeatingSettingsInfo {
  hotwater_schedule_start?: string;
  hotwater_schedule_end?: string;
}

export function LearningProgress() {
  const [features, setFeatures] = useState<RoomMLFeatures[]>([]);
  const [recentEvents, setRecentEvents] = useState<LearningEvent[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [heatingSettings, setHeatingSettings] = useState<HeatingSettingsInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const today = getLocalDateString();
      
      const [featuresResult, eventsResult, roomsResult, settingsResult] = await Promise.all([
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
          .select('id, name, current_temp, target_temp, tuya_device_id'),
        supabase
          .from('heating_settings')
          .select('hotwater_schedule_start, hotwater_schedule_end')
          .limit(1)
          .maybeSingle()
      ]);

      setFeatures((featuresResult.data || []) as RoomMLFeatures[]);
      setRecentEvents((eventsResult.data || []) as LearningEvent[]);
      setRooms((roomsResult.data || []) as RoomInfo[]);
      setHeatingSettings(settingsResult.data as HeatingSettingsInfo | null);
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
      const today = getLocalDateString();
      const todayStart = getLocalMidnightISO();
      
      // Fetch all required data including PV forecast and automation history
      const [readingsResult, settingsResult, mlFeaturesResult, rewardsResult, pvForecastResult, automationHistoryResult] = await Promise.all([
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
          .limit(10),
        supabase
          .from('pv_forecasts')
          .select('*')
          .eq('date', today)
          .maybeSingle(),
        // Fetch today's automation decisions for AI self-awareness
        supabase
          .from('learning_events')
          .select('room_id, decision_type, action, context, timestamp')
          .gte('timestamp', todayStart)
          .order('timestamp', { ascending: false })
      ]);

      const currentReading = readingsResult.data?.[0];
      const heatingSettings = settingsResult.data;
      const mlFeatures = mlFeaturesResult.data || [];
      const recentRewards = rewardsResult.data || [];
      const pvForecast = pvForecastResult.data;
      const automationHistory = automationHistoryResult.data || [];

      if (!currentReading) {
        toast.error('Keine aktuellen Energiedaten verfügbar');
        return;
      }

      // Call analyze-patterns with optimize_decision type including PV forecast and automation history
      const { data, error } = await supabase.functions.invoke('analyze-patterns', {
        body: {
          readings: [currentReading],
          heatingSettings: heatingSettings,
          rooms: rooms,
          mlFeatures: mlFeatures,
          recentRewards: recentRewards,
          pvForecast: pvForecast,
          automationHistory: automationHistory,
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
          expected_total_savings_wh: data.expected_total_savings_wh,
          hotwater_recommendation: data.hotwater_recommendation,
          thermostat_schedule: data.thermostat_schedule,
          night_cycling: data.night_cycling
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
                <div className="space-y-3">
                  {/* Strategy Summary */}
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                    <p className="text-sm text-foreground leading-relaxed">
                      {analysisResult.overall_strategy}
                    </p>
                    {analysisResult.expected_total_savings_wh && (
                      <p className="text-xs text-muted-foreground mt-2">
                        💡 Erwartete Einsparung: ~{Math.round(analysisResult.expected_total_savings_wh)} Wh
                      </p>
                    )}
                  </div>

                  {/* Smartfox Hotwater Recommendation */}
                  {analysisResult.hotwater_recommendation && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Droplets className="h-3 w-3" />
                        Smartfox Warmwasser-Zeitschaltung:
                      </h5>
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 space-y-3">
                        {/* Current vs Recommended comparison */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="text-center p-2 bg-muted/30 rounded">
                            <span className="text-[10px] text-muted-foreground block mb-1">Aktuelle Einstellung</span>
                            <span className="text-sm font-mono">
                              {heatingSettings?.hotwater_schedule_start || '10:00'} - {heatingSettings?.hotwater_schedule_end || '14:00'}
                            </span>
                          </div>
                          <div className="text-center p-2 bg-blue-500/20 rounded border border-blue-500/40">
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 block mb-1">KI-Empfehlung</span>
                            <span className="text-lg font-bold text-blue-600 dark:text-blue-400 font-mono">
                              {analysisResult.hotwater_recommendation.recommended_start} - {analysisResult.hotwater_recommendation.recommended_end}
                            </span>
                          </div>
                        </div>
                        
                        {/* Arrow indicator if different */}
                        {(heatingSettings?.hotwater_schedule_start !== analysisResult.hotwater_recommendation.recommended_start ||
                          heatingSettings?.hotwater_schedule_end !== analysisResult.hotwater_recommendation.recommended_end) && (
                          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-1.5 rounded">
                            <AlertCircle className="h-3 w-3 shrink-0" />
                            <span>→ Am Smartfox auf <strong>{analysisResult.hotwater_recommendation.recommended_start}-{analysisResult.hotwater_recommendation.recommended_end}</strong> ändern</span>
                          </div>
                        )}
                        
                        {analysisResult.hotwater_recommendation.min_surplus_w && (
                          <p className="text-xs text-muted-foreground">
                            Mind. Überschuss: {analysisResult.hotwater_recommendation.min_surplus_w}W
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">
                          {analysisResult.hotwater_recommendation.reasoning}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* TGP508 Thermostat Schedule */}
                  {analysisResult.thermostat_schedule && analysisResult.thermostat_schedule.length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        TGP508 Heizprogramm (am Thermostat einstellen):
                      </h5>
                      <div className="bg-muted/30 border border-border/50 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 gap-y-0.5 text-xs">
                          {analysisResult.thermostat_schedule.map((period) => (
                            <div key={period.period} className="contents">
                              <div className="bg-primary/10 px-2 py-1.5 font-mono font-medium text-primary">
                                P{period.period}
                              </div>
                              <div className="flex items-center gap-1 py-1.5">
                                <span className="font-mono">{period.start_time}-{period.end_time}</span>
                              </div>
                              <div className="flex items-center gap-1 py-1.5">
                                <span className="text-lg font-bold">{period.temperature}°C</span>
                              </div>
                              <div className="flex items-center gap-1 py-1.5 pr-2">
                                <Badge 
                                  variant={period.mode === 'comfort' ? 'default' : period.mode === 'night' ? 'secondary' : 'outline'}
                                  className="text-[10px] px-1.5 h-5"
                                >
                                  {period.mode === 'comfort' && <Sun className="h-2.5 w-2.5 mr-0.5" />}
                                  {period.mode === 'eco' && <Thermometer className="h-2.5 w-2.5 mr-0.5" />}
                                  {period.mode === 'night' && <Moon className="h-2.5 w-2.5 mr-0.5" />}
                                  {period.mode === 'off' && <Snowflake className="h-2.5 w-2.5 mr-0.5" />}
                                  {period.mode}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Night Cycling Recommendation */}
                  {analysisResult.night_cycling && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Moon className="h-3 w-3" />
                        Nachtzyklen:
                      </h5>
                      <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">Empfehlung:</span>
                          <span className="text-xl font-bold text-purple-600 dark:text-purple-400">
                            {analysisResult.night_cycling.cycles_per_room} Zyklen/Raum
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {analysisResult.night_cycling.reasoning}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Thermostat Recommendations */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Flame className="h-3 w-3" />
                      Aktuelle Thermostat-Einstellungen:
                    </h5>
                    <div className="space-y-2">
                      {analysisResult.decisions.map((decision, idx) => (
                        <div 
                          key={decision.room_id || idx} 
                          className="flex items-center justify-between bg-muted/30 rounded-lg p-3 border border-border/50"
                        >
                          <div className="flex items-center gap-3">
                            {getActionIcon(decision.action, decision.priority)}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{decision.room_name}</span>
                                <Badge 
                                  variant={getActionBadgeVariant(decision.action, decision.priority)}
                                  className="text-[10px] px-1.5 h-5"
                                >
                                  {getActionLabel(decision.action, decision.priority)}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px]">
                                {decision.reasoning}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-bold text-foreground">
                              {decision.target_temp}°C
                            </span>
                            {decision.confidence !== undefined && (
                              <p className="text-[10px] text-muted-foreground">
                                {Math.round(decision.confidence * 100)}% sicher
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <p className="text-xs">
                    {tuyaRooms.length === 0 
                      ? 'Keine Tuya-Thermostate konfiguriert' 
                      : 'Klicke "Analyse starten" für KI-Empfehlungen'}
                  </p>
                </div>
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
