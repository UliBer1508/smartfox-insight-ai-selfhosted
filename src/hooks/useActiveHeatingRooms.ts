import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getLocalMidnightISO } from '@/lib/dateUtils';
import { Room, getEffectiveHeatingPower } from '@/types/room';

export interface ActiveHeatingRoom {
  room_id: string;
  room_name: string;
  power: number;
  duration_min: number;
  start_time: string;
  source: 'log' | 'is_heating';
}

export type ActivationReason = 'plan' | 'setpoint' | 'queue';

interface ActiveHeatingRoomsResult {
  activeRooms: ActiveHeatingRoom[];
  totalHeatingPower: number;
  isLoading: boolean;
  /** Quelle der aktuell angezeigten Daten: A=Logs, B=is_heating, C=stale (keine zuverlässigen Daten) */
  sourceLevel: 'A' | 'B' | 'C';
  /** Sekunden seit letztem Tuya-Sync (max über alle Räume mit Device) */
  lastSyncAgeSec: number | null;
  /** Räume, die die Automatik aktuell auf Heizen geschaltet hat (Plan/Setpoint/Queue) */
  activatedRoomIds: Set<string>;
  /** Quelle der Aktivierung pro Raum */
  activationReasons: Map<string, ActivationReason>;
  refetch: () => Promise<void>;
}

const SYNC_FRESH_SEC = 10 * 60;   // Stufe B: <10 min
const SYNC_STALE_SEC = 15 * 60;   // Stufe C: >15 min

/**
 * Live-Heizstatus mit dreistufigem Fallback:
 *  A) room_heating_logs der letzten 4 h (offene Zyklen)
 *  B) rooms.is_heating + last_thermostat_sync < 10 min  (wenn Logs leer)
 *  C) Stale: Logs leer UND letzter Sync > 15 min → keine zuverlässige Aussage
 */
export function useActiveHeatingRooms(): ActiveHeatingRoomsResult {
  const [activeRooms, setActiveRooms] = useState<ActiveHeatingRoom[]>([]);
  const [sourceLevel, setSourceLevel] = useState<'A' | 'B' | 'C'>('A');
  const [lastSyncAgeSec, setLastSyncAgeSec] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activatedRoomIds, setActivatedRoomIds] = useState<Set<string>>(new Set());
  const [activationReasons, setActivationReasons] = useState<Map<string, ActivationReason>>(new Map());

  const loadActiveRooms = useCallback(async () => {
    setIsLoading(true);
    try {
      const todayStart = getLocalMidnightISO();

      const [logsResult, roomsResult, planResult, queueResult] = await Promise.all([
        supabase
          .from('room_heating_logs')
          .select('room_id, event_type, timestamp')
          .gte('timestamp', todayStart)
          .in('event_type', ['heating_start', 'heating_stop'])
          .order('timestamp', { ascending: false }),
        supabase
          .from('rooms')
          .select('id, name, heating_power_w, calculated_power_w, power_calculation_confidence, power_samples, floor_area_m2, is_heating, last_thermostat_sync, tuya_device_id, target_temp, current_temp, eco_temp, comfort_temp, night_temp, automation_enabled, last_auto_change'),
        supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'parallel_heating_capacity')
          .maybeSingle(),
        supabase
          .from('thermostat_commands')
          .select('room_id, command, status, created_at')
          .eq('status', 'pending')
          .in('command', ['set_target_temp', 'set_temperature'])
          .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString()),
      ]);

      if (logsResult.error) throw logsResult.error;
      if (roomsResult.error) throw roomsResult.error;

      const logs = logsResult.data || [];
      const rooms = (roomsResult.data || []) as (Room & { is_heating?: boolean; last_thermostat_sync?: string | null; tuya_device_id?: string | null; eco_temp?: number | null; comfort_temp?: number | null; night_temp?: number | null; automation_enabled?: boolean | null; last_auto_change?: string | null })[];
      const roomMap = new Map(rooms.map(r => [r.id, r]));

      // ---- Aktivierungs-Erkennung (Plan / Setpoint / Queue) ----
      const planVal = (planResult.data?.value as { planned_eco_room_ids?: string[]; planned_comfort_room_ids?: string[] } | null) || null;
      const plannedIds = new Set<string>([
        ...(planVal?.planned_eco_room_ids ?? []),
        ...(planVal?.planned_comfort_room_ids ?? []),
      ]);
      const queueIds = new Set<string>((queueResult.data ?? []).map((c: { room_id: string }) => c.room_id));

      const nowMs = Date.now();
      const actIds = new Set<string>();
      const actReasons = new Map<string, ActivationReason>();
      for (const r of rooms) {
        if (plannedIds.has(r.id)) { actIds.add(r.id); actReasons.set(r.id, 'plan'); continue; }
        if (queueIds.has(r.id)) { actIds.add(r.id); actReasons.set(r.id, 'queue'); continue; }
        // Setpoint-Heuristik: Automatik aktiv, target ≥ eco-0.2, last_auto_change < 10 min
        if (
          r.automation_enabled &&
          r.target_temp != null &&
          r.eco_temp != null &&
          r.target_temp >= r.eco_temp - 0.2 &&
          r.last_auto_change &&
          nowMs - new Date(r.last_auto_change).getTime() < 10 * 60_000
        ) {
          actIds.add(r.id);
          actReasons.set(r.id, 'setpoint');
        }
      }
      setActivatedRoomIds(actIds);
      setActivationReasons(actReasons);


      // ---- Sync-Alter berechnen (max über alle Räume mit Device) ----
      const now = Date.now();
      let oldestSyncMs: number | null = null;
      for (const r of rooms) {
        if (!r.tuya_device_id) continue;
        if (!r.last_thermostat_sync) { oldestSyncMs = Number.MAX_SAFE_INTEGER; break; }
        const ageMs = now - new Date(r.last_thermostat_sync).getTime();
        if (oldestSyncMs === null || ageMs > oldestSyncMs) oldestSyncMs = ageMs;
      }
      const syncAgeSec = oldestSyncMs === null ? null : Math.round(oldestSyncMs / 1000);
      setLastSyncAgeSec(syncAgeSec);

      // ---- Stufe A: offene Zyklen aus Logs ----
      const roomEventCounts = new Map<string, { starts: number; stops: number; lastStart: string | null }>();
      for (const log of logs) {
        if (!roomEventCounts.has(log.room_id)) {
          roomEventCounts.set(log.room_id, { starts: 0, stops: 0, lastStart: null });
        }
        const c = roomEventCounts.get(log.room_id)!;
        if (log.event_type === 'heating_start') {
          c.starts++;
          if (!c.lastStart && log.timestamp) c.lastStart = log.timestamp;
        } else if (log.event_type === 'heating_stop') {
          c.stops++;
        }
      }

      const fromLogs: ActiveHeatingRoom[] = [];
      for (const [roomId, c] of roomEventCounts) {
        if (c.starts > c.stops && c.lastStart) {
          const room = roomMap.get(roomId);
          if (room) {
            const startMs = new Date(c.lastStart).getTime();
            fromLogs.push({
              room_id: roomId,
              room_name: room.name,
              power: getEffectiveHeatingPower(room as Room),
              duration_min: Math.round((now - startMs) / 60000),
              start_time: c.lastStart,
              source: 'log',
            });
          }
        }
      }

      if (fromLogs.length > 0) {
        fromLogs.sort((a, b) => b.power - a.power);
        console.log('[ActiveHeatingRooms] Stufe A (Logs):', fromLogs.length);
        setActiveRooms(fromLogs);
        setSourceLevel('A');
        return;
      }

      // ---- Stufe B: is_heating mit frischem Sync ----
      const syncFresh = syncAgeSec !== null && syncAgeSec <= SYNC_FRESH_SEC;
      if (syncFresh) {
        const fromState: ActiveHeatingRoom[] = rooms
          .filter(r => r.is_heating === true && r.tuya_device_id)
          .map(r => ({
            room_id: r.id,
            room_name: r.name,
            power: getEffectiveHeatingPower(r as Room),
            duration_min: 0,
            start_time: r.last_thermostat_sync || new Date().toISOString(),
            source: 'is_heating' as const,
          }));
        fromState.sort((a, b) => b.power - a.power);
        console.log('[ActiveHeatingRooms] Stufe B (is_heating, sync', syncAgeSec, 's):', fromState.length);
        setActiveRooms(fromState);
        setSourceLevel('B');
        return;
      }

      // ---- Stufe C: stale ----
      console.log('[ActiveHeatingRooms] Stufe C (stale, sync age:', syncAgeSec, 's)');
      setActiveRooms([]);
      setSourceLevel('C');
    } catch (error) {
      console.error('[ActiveHeatingRooms] Error loading active rooms:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActiveRooms();
    const interval = setInterval(loadActiveRooms, 30000);
    return () => clearInterval(interval);
  }, [loadActiveRooms]);

  const totalHeatingPower = activeRooms.reduce((sum, r) => sum + r.power, 0);

  return { activeRooms, totalHeatingPower, isLoading, sourceLevel, lastSyncAgeSec, activatedRoomIds, activationReasons, refetch: loadActiveRooms };
}
