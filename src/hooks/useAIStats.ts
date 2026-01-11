import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface LearningAction {
  id: string;
  decision_type: string;
  room_id: string | null;
  room_name?: string;
  action: {
    target_temp?: number;
    reasoning?: string;
    previous_temp?: number;
  };
  timestamp: string;
  reward?: number | null;
  is_evaluated?: boolean;
}

interface AIStats {
  totalDecisions: number;
  evaluatedCount: number;
  evaluatedPercent: number;
  avgReward: number;
  avgConfidence: number;
  roomCount: number;
}

export function useAIStats() {
  const [recentActions, setRecentActions] = useState<LearningAction[]>([]);
  const [stats, setStats] = useState<AIStats>({
    totalDecisions: 0,
    evaluatedCount: 0,
    evaluatedPercent: 0,
    avgReward: 0,
    avgConfidence: 0,
    roomCount: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      // Load recent learning events with room info
      const { data: events, error: eventsError } = await supabase
        .from('learning_events')
        .select(`
          id,
          decision_type,
          room_id,
          action,
          timestamp,
          reward,
          is_evaluated
        `)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (eventsError) throw eventsError;

      // Load rooms for name mapping
      const { data: rooms } = await supabase
        .from('rooms')
        .select('id, name');

      const roomMap = new Map(rooms?.map(r => [r.id, r.name]) || []);

      // Map recent actions with room names
      const recent = (events || []).slice(0, 5).map(e => ({
        ...e,
        room_name: e.room_id ? roomMap.get(e.room_id) || 'Unbekannt' : undefined,
        action: e.action as LearningAction['action']
      }));
      setRecentActions(recent);

      // Calculate stats from all events
      const allEvents = events || [];
      const evaluated = allEvents.filter(e => e.is_evaluated);
      const withReward = evaluated.filter(e => e.reward !== null);
      
      // Load ML features for confidence
      const { data: mlFeatures } = await supabase
        .from('room_ml_features')
        .select('confidence, room_id')
        .order('date', { ascending: false });

      // Get unique rooms with ML data
      const roomsWithML = new Set(mlFeatures?.map(f => f.room_id) || []);
      
      // Calculate average confidence from latest features per room
      const latestConfidencePerRoom = new Map<string, number>();
      mlFeatures?.forEach(f => {
        if (!latestConfidencePerRoom.has(f.room_id) && f.confidence !== null) {
          latestConfidencePerRoom.set(f.room_id, f.confidence);
        }
      });
      const confidences = Array.from(latestConfidencePerRoom.values());
      const avgConf = confidences.length > 0 
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length 
        : 0;

      setStats({
        totalDecisions: allEvents.length,
        evaluatedCount: evaluated.length,
        evaluatedPercent: allEvents.length > 0 ? Math.round((evaluated.length / allEvents.length) * 100) : 0,
        avgReward: withReward.length > 0 
          ? withReward.reduce((sum, e) => sum + (e.reward || 0), 0) / withReward.length 
          : 0,
        avgConfidence: Math.round(avgConf * 100),
        roomCount: roomsWithML.size
      });

    } catch (error) {
      console.error('Error loading AI stats:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    
    // Refresh every 2 minutes
    const interval = setInterval(loadStats, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadStats]);

  return {
    recentActions,
    stats,
    isLoading,
    refresh: loadStats
  };
}
