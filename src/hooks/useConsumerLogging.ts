import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ActiveConsumer } from './useConsumptionAnalysis';

const MAX_SESSION_HOURS = 4;

interface ActiveSession {
  logId: string;
  consumerType: string;
  startTime: Date;
  powerSamples: number[];
  maxPower: number;
}

export function useConsumerLogging(activeConsumers: ActiveConsumer[], currentConsumption: number | null) {
  const activeSessions = useRef<Map<string, ActiveSession>>(new Map());
  const lastUpdateTime = useRef<Date>(new Date());
  const cleanupDone = useRef(false);

  // Cleanup verwaister Sessions beim Mount
  useEffect(() => {
    if (cleanupDone.current) return;
    cleanupDone.current = true;

    const cleanup = async () => {
      const { data, error } = await supabase
        .from('consumer_logs')
        .update({
          is_active: false,
          end_time: new Date().toISOString(),
        })
        .eq('is_active', true)
        .select('id');

      if (!error && data && data.length > 0) {
        console.log(`[ConsumerLogging] Cleanup: ${data.length} verwaiste Sessions geschlossen`);
      }
    };
    cleanup();
  }, []);

  const startSession = useCallback(async (consumer: ActiveConsumer) => {
    const consumerType = getConsumerType(consumer.name);
    if (activeSessions.current.has(consumerType)) return;

    const { data, error } = await supabase
      .from('consumer_logs')
      .insert({
        consumer_type: consumerType,
        start_time: new Date().toISOString(),
        avg_power_w: Math.round(consumer.power),
        max_power_w: Math.round(consumer.power),
        is_active: true
      })
      .select('id')
      .single();

    if (data && !error) {
      activeSessions.current.set(consumerType, {
        logId: data.id,
        consumerType,
        startTime: new Date(),
        powerSamples: [Math.round(consumer.power)],
        maxPower: Math.round(consumer.power)
      });
      console.log(`[ConsumerLogging] Session gestartet: ${consumerType}`);
    }
  }, []);

  const endSession = useCallback(async (consumerType: string) => {
    const session = activeSessions.current.get(consumerType);
    if (!session) return;

    const endTime = new Date();
    const durationMinutes = Math.round((endTime.getTime() - session.startTime.getTime()) / 60000);
    const avgPower = Math.round(session.powerSamples.reduce((a, b) => a + b, 0) / session.powerSamples.length);
    const totalEnergyWh = Math.round((avgPower * durationMinutes) / 60);

    await supabase
      .from('consumer_logs')
      .update({
        end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        avg_power_w: avgPower,
        max_power_w: session.maxPower,
        total_energy_wh: totalEnergyWh,
        is_active: false
      })
      .eq('id', session.logId);

    activeSessions.current.delete(consumerType);
    console.log(`[ConsumerLogging] Session beendet: ${consumerType} - ${durationMinutes} Min, ${avgPower}W avg, ${totalEnergyWh}Wh`);
  }, []);

  const updateSession = useCallback(async (consumer: ActiveConsumer) => {
    const consumerType = getConsumerType(consumer.name);
    const session = activeSessions.current.get(consumerType);
    if (!session) return;

    // Auto-close sessions exceeding max duration
    const runningHours = (Date.now() - session.startTime.getTime()) / 3600000;
    if (runningHours >= MAX_SESSION_HOURS) {
      console.log(`[ConsumerLogging] Session ${consumerType} überschreitet ${MAX_SESSION_HOURS}h - wird geschlossen`);
      await endSession(consumerType);
      return;
    }

    session.powerSamples.push(Math.round(consumer.power));
    session.maxPower = Math.max(session.maxPower, Math.round(consumer.power));

    const now = new Date();
    if (now.getTime() - lastUpdateTime.current.getTime() > 60000) {
      const avgPower = Math.round(session.powerSamples.reduce((a, b) => a + b, 0) / session.powerSamples.length);
      await supabase
        .from('consumer_logs')
        .update({ avg_power_w: avgPower, max_power_w: session.maxPower })
        .eq('id', session.logId);
      lastUpdateTime.current = now;
    }
  }, [endSession]);

  useEffect(() => {
    if (currentConsumption === null) return;

    const activeTypes = new Set(activeConsumers.map(c => getConsumerType(c.name)));

    for (const consumer of activeConsumers) {
      const type = getConsumerType(consumer.name);
      if (!activeSessions.current.has(type)) {
        startSession(consumer);
      } else {
        updateSession(consumer);
      }
    }

    for (const [type] of activeSessions.current) {
      if (!activeTypes.has(type)) {
        endSession(type);
      }
    }
  }, [activeConsumers, currentConsumption, startSession, endSession, updateSession]);

  useEffect(() => {
    return () => {
      for (const [type] of activeSessions.current) {
        endSession(type);
      }
    };
  }, [endSession]);
}

function getConsumerType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('auto') || lower.includes('car')) return 'car';
  if (lower.includes('wasser') || lower.includes('water')) return 'hotwater';
  return 'heating';
}
