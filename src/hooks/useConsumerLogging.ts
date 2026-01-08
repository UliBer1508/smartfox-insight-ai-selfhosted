import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ActiveConsumer } from './useConsumptionAnalysis';

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

  // Startet eine neue Log-Session für einen Verbraucher
  const startSession = useCallback(async (consumer: ActiveConsumer) => {
    const consumerType = getConsumerType(consumer.name);
    
    // Prüfen ob bereits eine Session läuft
    if (activeSessions.current.has(consumerType)) {
      return;
    }

    const { data, error } = await supabase
      .from('consumer_logs')
      .insert({
        consumer_type: consumerType,
        start_time: new Date().toISOString(),
        avg_power_w: consumer.power,
        max_power_w: consumer.power,
        is_active: true
      })
      .select('id')
      .single();

    if (data && !error) {
      activeSessions.current.set(consumerType, {
        logId: data.id,
        consumerType,
        startTime: new Date(),
        powerSamples: [consumer.power],
        maxPower: consumer.power
      });
      console.log(`[ConsumerLogging] Session gestartet: ${consumerType}`);
    }
  }, []);

  // Beendet eine Log-Session
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

  // Aktualisiert eine laufende Session
  const updateSession = useCallback(async (consumer: ActiveConsumer) => {
    const consumerType = getConsumerType(consumer.name);
    const session = activeSessions.current.get(consumerType);
    if (!session) return;

    session.powerSamples.push(consumer.power);
    session.maxPower = Math.max(session.maxPower, consumer.power);

    // Nur alle 60 Sekunden in DB updaten
    const now = new Date();
    if (now.getTime() - lastUpdateTime.current.getTime() > 60000) {
      const avgPower = Math.round(session.powerSamples.reduce((a, b) => a + b, 0) / session.powerSamples.length);
      
      await supabase
        .from('consumer_logs')
        .update({
          avg_power_w: avgPower,
          max_power_w: session.maxPower
        })
        .eq('id', session.logId);
      
      lastUpdateTime.current = now;
    }
  }, []);

  // Haupteffekt: Beobachtet Verbraucher und startet/beendet Sessions
  useEffect(() => {
    if (currentConsumption === null) return;

    const activeTypes = new Set(activeConsumers.map(c => getConsumerType(c.name)));
    
    // Neue Sessions starten
    for (const consumer of activeConsumers) {
      const type = getConsumerType(consumer.name);
      if (!activeSessions.current.has(type)) {
        startSession(consumer);
      } else {
        updateSession(consumer);
      }
    }

    // Beendete Sessions schließen
    for (const [type] of activeSessions.current) {
      if (!activeTypes.has(type)) {
        endSession(type);
      }
    }
  }, [activeConsumers, currentConsumption, startSession, endSession, updateSession]);

  // Cleanup beim Unmount
  useEffect(() => {
    return () => {
      // Alle aktiven Sessions beenden
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
