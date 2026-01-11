import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, ChevronDown, Sparkles, Flame, Snowflake, Zap, CheckCircle2, Settings, AlertTriangle, ArrowRight, ChevronRight, Info } from 'lucide-react';
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
  heating_power_w?: number | null;
}

interface ThermostatDecision {
  room_id: string;
  room_name: string;
  action: 'activate' | 'deactivate' | 'keep';
  current_temp?: number;
  target_temp: number;
  temp_change?: number;
  reasoning?: string;
  reasoning_short?: string;
  reasoning_detailed?: string;
  expected_savings_wh?: number;
  expected_savings_eur?: number;
  action_description?: string;
  confidence?: number;
  priority?: string;
}

interface SystemRecommendation {
  setting_key: string;
  setting_name: string;
  current_value: string;
  recommended_value: string;
  reason_why: string;
  expected_result: string;
  priority?: string;
}

interface SituationSummary {
  energy_status?: string;
  problems_found?: string[];
  overall_recommendation?: string;
}

interface AnalysisResult {
  decisions: ThermostatDecision[];
  overall_strategy: string;
  expected_total_savings_wh?: number;
  situation_summary?: SituationSummary;
  system_recommendations?: SystemRecommendation[];
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
  const [isApplying, setIsApplying] = useState<string | null>(null);
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);

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
          .select('id, name, current_temp, target_temp, tuya_device_id, heating_power_w')
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
        const decisionsWithNames = data.decisions.map((d: ThermostatDecision) => ({
          ...d,
          room_name: d.room_name || rooms.find(r => r.id === d.room_id)?.name || 'Unbekannt'
        }));

        setAnalysisResult({
          decisions: decisionsWithNames,
          overall_strategy: data.overall_strategy || 'Optimale Heizstrategie basierend auf aktueller Energiesituation',
          expected_total_savings_wh: data.expected_total_savings_wh,
          situation_summary: data.situation_summary,
          system_recommendations: data.system_recommendations
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

  const applyDecision = async (decision: ThermostatDecision) => {
    const room = rooms.find(r => r.id === decision.room_id || r.name === decision.room_name);
    if (!room?.tuya_device_id) {
      toast.error(`Kein Tuya-Gerät für ${decision.room_name}`);
      return;
    }

    setIsApplying(decision.room_id);
    try {
      const { data, error } = await supabase.functions.invoke('tuya-control', {
        body: { 
          action: 'set-temp',
          deviceId: room.tuya_device_id, 
          temperature: decision.target_temp,
          roomId: room.id
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      // Update room in DB
      await supabase.from('rooms').update({
        target_temp: decision.target_temp,
        manual_override_until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      }).eq('id', room.id);

      toast.success(`${decision.room_name}: ${decision.target_temp}°C gesetzt`);
    } catch (error) {
      console.error('Error applying decision:', error);
      toast.error(`Fehler bei ${decision.room_name}`);
    } finally {
      setIsApplying(null);
    }
  };

  const applyAllDecisions = async () => {
    if (!analysisResult?.decisions?.length) return;

    const applicableDecisions = analysisResult.decisions.filter(d => {
      const room = rooms.find(r => r.id === d.room_id || r.name === d.room_name);
      return room?.tuya_device_id && d.action !== 'keep';
    });

    if (applicableDecisions.length === 0) {
      toast.info('Keine anwendbaren Änderungen');
      return;
    }

    setIsApplyingAll(true);
    let successCount = 0;

    for (const decision of applicableDecisions) {
      try {
        const room = rooms.find(r => r.id === decision.room_id || r.name === decision.room_name);
        if (!room?.tuya_device_id) continue;

        const { data, error } = await supabase.functions.invoke('tuya-control', {
          body: { 
            action: 'set-temp',
            deviceId: room.tuya_device_id, 
            temperature: decision.target_temp,
            roomId: room.id
          }
        });

        if (!error && data?.success) {
          await supabase.from('rooms').update({
            target_temp: decision.target_temp,
            manual_override_until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
          }).eq('id', room.id);
          successCount++;
        }
      } catch (error) {
        console.error(`Error applying to ${decision.room_name}:`, error);
      }
    }

    setIsApplyingAll(false);
    if (successCount > 0) {
      toast.success(`${successCount}/${applicableDecisions.length} Empfehlungen angewendet`);
      loadData();
    } else {
      toast.error('Keine Empfehlungen konnten angewendet werden');
    }
  };

  const applySystemRecommendation = async (rec: SystemRecommendation) => {
    try {
      // Parse the recommended value
      const value = parseFloat(rec.recommended_value.replace(/[^\d.-]/g, ''));
      
      const { error } = await supabase
        .from('heating_settings')
        .update({ [rec.setting_key]: value })
        .eq('id', (await supabase.from('heating_settings').select('id').limit(1).single()).data?.id);

      if (error) throw error;

      toast.success(`${rec.setting_name} auf ${rec.recommended_value} gesetzt`);
      
      // Remove from recommendations
      if (analysisResult?.system_recommendations) {
        setAnalysisResult({
          ...analysisResult,
          system_recommendations: analysisResult.system_recommendations.filter(r => r.setting_key !== rec.setting_key)
        });
      }
    } catch (error) {
      console.error('Error applying system recommendation:', error);
      toast.error('Fehler beim Anwenden der Einstellung');
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

  const getPriorityColor = (priority?: string) => {
    if (priority === 'high') return 'text-red-500';
    if (priority === 'medium') return 'text-yellow-500';
    return 'text-muted-foreground';
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
  const applicableDecisions = analysisResult?.decisions?.filter(d => d.action !== 'keep') || [];

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">KI-Heizungsoptimierung</CardTitle>
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
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  KI-Empfehlungen
                </h4>
                <div className="flex items-center gap-2">
                  {applicableDecisions.length > 0 && (
                    <Button 
                      variant="default" 
                      size="sm" 
                      className="h-7 text-xs"
                      onClick={applyAllDecisions}
                      disabled={isApplyingAll}
                    >
                      {isApplyingAll ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          Wende an...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Alle ({applicableDecisions.length}) anwenden
                        </>
                      )}
                    </Button>
                  )}
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
                        Analyse
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {analysisResult ? (
                <div className="space-y-3">
                  {/* Situation Summary */}
                  {analysisResult.situation_summary && (
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 text-primary mt-0.5" />
                        <div className="flex-1">
                          {analysisResult.situation_summary.energy_status && (
                            <p className="text-sm font-medium">{analysisResult.situation_summary.energy_status}</p>
                          )}
                          {analysisResult.situation_summary.problems_found && analysisResult.situation_summary.problems_found.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {analysisResult.situation_summary.problems_found.map((problem, idx) => (
                                <p key={idx} className="text-xs text-muted-foreground flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3 text-yellow-500" />
                                  {problem}
                                </p>
                              ))}
                            </div>
                          )}
                          {analysisResult.situation_summary.overall_recommendation && (
                            <p className="text-xs text-primary mt-1 font-medium">
                              💡 {analysisResult.situation_summary.overall_recommendation}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* System Recommendations */}
                  {analysisResult.system_recommendations && analysisResult.system_recommendations.length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Settings className="h-3 w-3" />
                        System-Optimierungen
                      </h5>
                      {analysisResult.system_recommendations.map((rec, idx) => (
                        <div key={idx} className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 space-y-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <AlertTriangle className={`h-4 w-4 ${getPriorityColor(rec.priority)}`} />
                              <span className="font-medium text-sm">{rec.setting_name}</span>
                            </div>
                            <Button 
                              size="sm" 
                              variant="outline"
                              className="h-6 text-xs"
                              onClick={() => applySystemRecommendation(rec)}
                            >
                              Anwenden
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">{rec.current_value}</span>
                            <ArrowRight className="h-3 w-3" />
                            <span className="font-medium text-primary">{rec.recommended_value}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{rec.reason_why}</p>
                          <p className="text-xs text-green-600">✓ {rec.expected_result}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Thermostat Recommendations */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Flame className="h-3 w-3" />
                      Thermostat-Empfehlungen
                    </h5>
                    {analysisResult.decisions.map((decision, idx) => {
                      const isExpanded = expandedDecision === decision.room_id;
                      const room = rooms.find(r => r.id === decision.room_id || r.name === decision.room_name);
                      const hasDetails = decision.reasoning_detailed || decision.action_description;
                      
                      return (
                        <div 
                          key={decision.room_id || idx} 
                          className={`rounded-lg border transition-all ${
                            decision.action === 'keep' 
                              ? 'bg-muted/20 border-border/50' 
                              : 'bg-muted/40 border-border'
                          }`}
                        >
                          {/* Main Row */}
                          <div 
                            className="flex items-center justify-between p-3 cursor-pointer"
                            onClick={() => hasDetails && setExpandedDecision(isExpanded ? null : decision.room_id)}
                          >
                            <div className="flex items-center gap-3 flex-1">
                              {getActionIcon(decision.action, decision.priority)}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{decision.room_name}</span>
                                  <Badge 
                                    variant={getActionBadgeVariant(decision.action, decision.priority)}
                                    className="text-[10px] px-1.5 h-4"
                                  >
                                    {getActionLabel(decision.action, decision.priority)}
                                  </Badge>
                                  {decision.priority === 'high' && (
                                    <Badge variant="destructive" className="text-[10px] px-1 h-4">!</Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {decision.reasoning_short || decision.reasoning}
                                </p>
                              </div>
                            </div>
                            
                            {/* Temperature Display */}
                            <div className="flex items-center gap-3">
                              {decision.current_temp !== undefined && decision.temp_change !== undefined && decision.temp_change !== 0 && (
                                <div className="text-right text-xs">
                                  <span className="text-muted-foreground">{decision.current_temp}°C</span>
                                  <span className={`ml-1 ${decision.temp_change > 0 ? 'text-orange-500' : 'text-cyan-500'}`}>
                                    {decision.temp_change > 0 ? '+' : ''}{decision.temp_change}°
                                  </span>
                                </div>
                              )}
                              <span className="text-xl font-bold text-foreground">
                                {decision.target_temp}°
                              </span>
                              {hasDetails && (
                                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                              )}
                            </div>
                          </div>

                          {/* Expanded Details */}
                          {isExpanded && hasDetails && (
                            <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/50">
                              {decision.reasoning_detailed && (
                                <div className="bg-background/50 rounded p-2 mt-2">
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Warum?</p>
                                  <p className="text-sm">{decision.reasoning_detailed}</p>
                                </div>
                              )}
                              
                              {decision.action_description && (
                                <div className="bg-background/50 rounded p-2">
                                  <p className="text-xs font-medium text-muted-foreground mb-1">Was passiert?</p>
                                  <p className="text-sm">{decision.action_description}</p>
                                </div>
                              )}

                              {(decision.expected_savings_wh || decision.expected_savings_eur) && (
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="text-green-600">
                                    💰 Einsparung: {decision.expected_savings_wh && `~${Math.round(decision.expected_savings_wh)} Wh`}
                                    {decision.expected_savings_eur && ` (${decision.expected_savings_eur.toFixed(2)}€)`}
                                  </span>
                                </div>
                              )}

                              {decision.action !== 'keep' && room?.tuya_device_id && (
                                <Button 
                                  size="sm" 
                                  className="w-full h-8 mt-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    applyDecision(decision);
                                  }}
                                  disabled={isApplying === decision.room_id}
                                >
                                  {isApplying === decision.room_id ? (
                                    <>
                                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                      Wird angewendet...
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Jetzt anwenden: {decision.target_temp}°C
                                    </>
                                  )}
                                </Button>
                              )}
                            </div>
                          )}

                          {/* Quick Apply Button (when not expanded) */}
                          {!isExpanded && decision.action !== 'keep' && room?.tuya_device_id && (
                            <div className="px-3 pb-2">
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="w-full h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  applyDecision(decision);
                                }}
                                disabled={isApplying === decision.room_id}
                              >
                                {isApplying === decision.room_id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <>Anwenden</>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  
                  {analysisResult.expected_total_savings_wh && analysisResult.expected_total_savings_wh > 0 && (
                    <p className="text-xs text-green-600 text-center font-medium">
                      💡 Gesamt-Einsparung: ~{Math.round(analysisResult.expected_total_savings_wh)} Wh 
                      ({(analysisResult.expected_total_savings_wh * 0.00025).toFixed(2)}€)
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-center text-muted-foreground py-2">
                  {tuyaRooms.length === 0 
                    ? 'Keine Tuya-Thermostate konfiguriert' 
                    : isAnalyzing ? 'Analysiere aktuelle Situation...' : 'Klicke "Analyse" für detaillierte Empfehlungen'}
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