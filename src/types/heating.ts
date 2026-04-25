export interface HeatingRecommendation {
  id?: string;
  date: string;
  period_number: number;
  start_time: string;
  end_time: string;
  recommended_temp: number;
  reason?: string;
  expected_pv_surplus?: number;
  priority?: 'battery' | 'heating' | 'conservation';
  created_at?: string;
}

export interface HeatingSettings {
  id?: string;
  pv_capacity_kwp: number;
  battery_capacity_kwh: number;
  /** @deprecated unused — kept as optional for backward compatibility with DB column */
  min_battery_soc?: number;
  /** @deprecated unused — use heating_min_battery_soc instead */
  target_battery_soc?: number;
  comfort_temp: number;
  eco_temp: number;
  night_temp: number;
  preheat_hours: number;
  latitude?: number;
  longitude?: number;
  roof_azimuth?: number;
  roof_declination?: number;
  // PV-Automatik Schwellwerte
  pv_surplus_threshold_on?: number;
  pv_surplus_threshold_off?: number;
  min_switch_interval_min?: number;
  // Verbraucher-Priorität
  consumer_priority?: string;
  // Fußbodenheizung-Parameter
  floor_heating_response_hours?: number;
  estrich_storage_enabled?: boolean;
  // E-Auto Integration
  car_charging_enabled?: boolean;
  car_min_charge_power_w?: number;
  // Warmwasser-Bereitung (Smartfox-gesteuert)
  hotwater_enabled?: boolean;
  hotwater_power_w?: number;
  hotwater_schedule_start?: string;
  hotwater_schedule_end?: string;
  hotwater_min_surplus_w?: number;
  // Heizungstyp-Information
  heating_type?: 'direct_electric' | 'heat_pump' | 'water';
  total_heating_power_w?: number;
  night_cycling_enabled?: boolean;
  avg_night_cycles_per_room?: number;
  // Strompreis-Konfiguration
  electricity_price_kwh_cent?: number;
  electricity_base_fee_year_eur?: number;
  feed_in_price_kwh_cent?: number;
  // Nacht-Zeiten
  night_start_time?: string;
  night_end_time?: string;
  // Leistungsbudget-Management
  power_budget_enabled?: boolean;
  max_grid_heating_power_w?: number;
  power_budget_tolerance_w?: number;
  room_rotation_minutes?: number;
  // PV-Boost
  pv_boost_temp_delta?: number;
  min_room_pause_minutes?: number;
  // Nacht-Heizmodus
  night_heating_mode?: 'maintain' | 'frost_only';
  // Mikro-Budget Modus
  micro_budget_enabled?: boolean;
  micro_budget_min_battery_soc?: number;
  micro_heat_duration_min?: number;
  // Batterie-Reserve & adaptive Budget-Erweiterung
  battery_reserve_for_night_soc?: number;
  battery_buffer_enabled?: boolean;
  battery_buffer_bonus_w?: number;
  tolerant_deactivation_enabled?: boolean;
  // Hartes SOC-Gate für Heizung
  heating_min_battery_soc?: number;
  heating_soc_gate_mode?: 'strict' | 'soft';
  created_at?: string;
  updated_at?: string;
}

export interface RoomHeatingLog {
  id?: string;
  room_id: string;
  timestamp?: string;
  event_type: 'heating_start' | 'heating_stop' | 'temp_change';
  current_temp?: number;
  target_temp?: number;
  duration_minutes?: number;
  energy_estimate_wh?: number;
  pv_surplus_w?: number;
  created_at?: string;
}

export interface PvForecast {
  id?: string;
  date: string;
  expected_kwh: number;
  hourly_watts: Record<string, number>;
  sunrise?: string;
  sunset?: string;
  fetched_at?: string;
  created_at?: string;
}

export interface TGP508Period {
  period: number;
  startTime: string;
  endTime: string;
  temperature: number;
  reason: string;
  icon: 'sun' | 'battery' | 'moon' | 'thermometer';
}

export interface HeatingAnalysisResult {
  periods: TGP508Period[];
  summary: string;
  expectedPvSurplus: number;
  batteryStrategy: string;
  recommendations: string[];
}
