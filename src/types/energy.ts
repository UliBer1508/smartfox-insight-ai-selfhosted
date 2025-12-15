export interface EnergyReading {
  id?: string;
  timestamp: string;
  power_io: number;
  energy_in: number;
  energy_out: number;
  created_at?: string;
}

export interface SmartfoxSettings {
  id?: string;
  smartfox_ip: string;
  polling_interval: number;
  api_path: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface HourlyAggregate {
  id?: string;
  hour_start: string;
  avg_power: number;
  max_power: number;
  min_power: number;
  total_energy_in: number;
  total_energy_out: number;
  reading_count: number;
}

export interface DailyPattern {
  id?: string;
  date: string;
  peak_power: number;
  peak_time?: string;
  avg_power: number;
  total_energy_in: number;
  total_energy_out: number;
  net_energy: number;
  pattern_type?: string;
}

export interface DetectedPattern {
  id?: string;
  pattern_name: string;
  description?: string;
  confidence?: number;
  start_time?: string;
  end_time?: string;
  avg_power?: number;
  occurrence_days?: string[];
  ai_analysis?: string;
  created_at?: string;
}

export interface SmartfoxApiResponse {
  power: number;
  energyIn: number;
  energyOut: number;
}
