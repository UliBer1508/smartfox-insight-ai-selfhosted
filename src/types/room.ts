export interface Room {
  id?: string;
  name: string;
  thermostat_type: string;
  orientation?: 'nord' | 'süd' | 'ost' | 'west' | null;
  has_solar_gain: boolean;
  floor_area_m2?: number | null;
  comfort_temp: number;
  eco_temp: number;
  night_temp: number;
  priority: number;
  heating_power_w?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface RoomRecommendation {
  id?: string;
  room_id: string;
  room_name?: string;
  date: string;
  period_number?: number;
  start_time: string;
  end_time: string;
  recommended_temp: number;
  reason?: string;
  priority?: 'heat_now' | 'preheat' | 'hold' | 'reduce' | 'off';
  created_at?: string;
}

export interface RoomWithRecommendation extends Room {
  current_recommendation?: RoomRecommendation;
}

export type OrientationType = 'nord' | 'süd' | 'ost' | 'west';

export const ORIENTATION_LABELS: Record<OrientationType, string> = {
  'nord': 'Nord',
  'süd': 'Süd',
  'ost': 'Ost',
  'west': 'West'
};

export const PRIORITY_ICONS = {
  'heat_now': '🔥',
  'preheat': '☀️',
  'hold': '⚡',
  'reduce': '🔋',
  'off': '❄️'
} as const;
