import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Brain, TrendingUp, TrendingDown, Minus, Zap, ThermometerSun, RefreshCw, Loader2 } from 'lucide-react';
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
}

export function LearningProgress() {
  const [features, setFeatures] = useState<RoomMLFeatures[]>([]);
  const [recentEvents, setRecentEvents] = useState<LearningEvent[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

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
          .limit(10),
        supabase
          .from('rooms')
          .select('id, name')
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

  const getRoomName = (roomId: string | null) => {
    if (!roomId) return 'Global';
    const room = rooms.find(r => r.id === roomId);
    return room?.name || 'Unbekannt';
  };

  const getRewardIcon = (reward: number | null) => {
    if (reward === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
    if (reward > 0.5) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (reward < -0.2) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-yellow-500" />;
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
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">ML-Lernfortschritt</CardTitle>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={extractFeatures}
            disabled={isExtracting}
          >
            {isExtracting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        <CardDescription>
          Automatische Optimierung durch kontinuierliches Lernen
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Übersicht */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{totalSamples}</div>
            <div className="text-xs text-muted-foreground">Datenpunkte</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{Math.round(avgConfidence * 100)}%</div>
            <div className="text-xs text-muted-foreground">Confidence</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">
              {avgReward !== null ? (avgReward > 0 ? '+' : '') + avgReward.toFixed(2) : '-'}
            </div>
            <div className="text-xs text-muted-foreground">Ø Reward</div>
          </div>
        </div>

        {/* Raum-Features */}
        {features.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <ThermometerSun className="h-4 w-4" />
              Gelernte Raum-Eigenschaften
            </h4>
            <div className="space-y-2">
              {features.map((f) => (
                <div key={f.room_id} className="bg-muted/30 rounded-lg p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{getRoomName(f.room_id)}</span>
                    <Badge variant={f.confidence > 0.7 ? 'default' : 'secondary'}>
                      {Math.round(f.confidence * 100)}%
                    </Badge>
                  </div>
                  <Progress value={f.confidence * 100} className="h-1.5 mb-2" />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div>Wärmeverlust: {f.heat_loss_rate_deg_per_hour?.toFixed(2) || '-'}°/h</div>
                    <div>Heizrate: {f.heating_rate_deg_per_hour?.toFixed(2) || '-'}°/h</div>
                    <div>Energie/°: {f.energy_per_degree_wh?.toFixed(0) || '-'} Wh</div>
                    <div>PV-Anteil: {f.pv_heating_ratio ? Math.round(f.pv_heating_ratio * 100) + '%' : '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Letzte Entscheidungen */}
        {recentEvents.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Letzte Entscheidungen
            </h4>
            <div className="space-y-1">
              {recentEvents.slice(0, 5).map((event) => (
                <div 
                  key={event.id} 
                  className="flex items-center justify-between text-sm bg-muted/30 rounded px-2 py-1"
                >
                  <div className="flex items-center gap-2">
                    {getRewardIcon(event.reward)}
                    <span className="text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString('de-DE', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </span>
                    <span>{event.decision_type.replace('_', ' ')}</span>
                    <span className="text-muted-foreground text-xs">
                      ({getRoomName(event.room_id)})
                    </span>
                  </div>
                  <div>
                    {event.is_evaluated ? (
                      <Badge variant={event.reward && event.reward > 0 ? 'default' : 'secondary'}>
                        {event.reward?.toFixed(2) || '0'}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Ausstehend</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {features.length === 0 && recentEvents.length === 0 && (
          <div className="text-center text-muted-foreground py-4">
            <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Noch keine Lerndaten vorhanden.</p>
            <p className="text-xs">Das System beginnt automatisch zu lernen.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
