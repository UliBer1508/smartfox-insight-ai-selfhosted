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
  min_battery_soc: number;
  target_battery_soc: number;
  comfort_temp: number;
  eco_temp: number;
  night_temp: number;
  preheat_hours: number;
  created_at?: string;
  updated_at?: string;
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
