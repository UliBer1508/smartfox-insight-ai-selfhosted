export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      daily_patterns: {
        Row: {
          avg_power: number
          created_at: string
          date: string
          id: string
          net_energy: number
          pattern_type: string | null
          peak_power: number
          peak_time: string | null
          total_energy_in: number
          total_energy_out: number
        }
        Insert: {
          avg_power: number
          created_at?: string
          date: string
          id?: string
          net_energy: number
          pattern_type?: string | null
          peak_power: number
          peak_time?: string | null
          total_energy_in: number
          total_energy_out: number
        }
        Update: {
          avg_power?: number
          created_at?: string
          date?: string
          id?: string
          net_energy?: number
          pattern_type?: string | null
          peak_power?: number
          peak_time?: string | null
          total_energy_in?: number
          total_energy_out?: number
        }
        Relationships: []
      }
      data_retention_settings: {
        Row: {
          auto_cleanup_enabled: boolean | null
          created_at: string | null
          hourly_retention_days: number | null
          id: string
          last_cleanup_at: string | null
          polling_interval_seconds: number | null
          raw_data_retention_days: number | null
          updated_at: string | null
        }
        Insert: {
          auto_cleanup_enabled?: boolean | null
          created_at?: string | null
          hourly_retention_days?: number | null
          id?: string
          last_cleanup_at?: string | null
          polling_interval_seconds?: number | null
          raw_data_retention_days?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_cleanup_enabled?: boolean | null
          created_at?: string | null
          hourly_retention_days?: number | null
          id?: string
          last_cleanup_at?: string | null
          polling_interval_seconds?: number | null
          raw_data_retention_days?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      detected_patterns: {
        Row: {
          ai_analysis: string | null
          avg_power: number | null
          confidence: number | null
          created_at: string
          description: string | null
          end_time: string | null
          id: string
          occurrence_days: string[] | null
          pattern_name: string
          start_time: string | null
        }
        Insert: {
          ai_analysis?: string | null
          avg_power?: number | null
          confidence?: number | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          id?: string
          occurrence_days?: string[] | null
          pattern_name: string
          start_time?: string | null
        }
        Update: {
          ai_analysis?: string | null
          avg_power?: number | null
          confidence?: number | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          id?: string
          occurrence_days?: string[] | null
          pattern_name?: string
          start_time?: string | null
        }
        Relationships: []
      }
      energy_readings: {
        Row: {
          battery_soc: number | null
          consumption: number | null
          created_at: string
          energy_in: number
          energy_out: number
          id: string
          power_io: number
          pv_power: number | null
          timestamp: string
        }
        Insert: {
          battery_soc?: number | null
          consumption?: number | null
          created_at?: string
          energy_in: number
          energy_out: number
          id?: string
          power_io: number
          pv_power?: number | null
          timestamp?: string
        }
        Update: {
          battery_soc?: number | null
          consumption?: number | null
          created_at?: string
          energy_in?: number
          energy_out?: number
          id?: string
          power_io?: number
          pv_power?: number | null
          timestamp?: string
        }
        Relationships: []
      }
      heating_recommendations: {
        Row: {
          created_at: string
          date: string
          end_time: string
          expected_pv_surplus: number | null
          id: string
          period_number: number
          priority: string | null
          reason: string | null
          recommended_temp: number
          start_time: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time: string
          expected_pv_surplus?: number | null
          id?: string
          period_number: number
          priority?: string | null
          reason?: string | null
          recommended_temp: number
          start_time: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string
          expected_pv_surplus?: number | null
          id?: string
          period_number?: number
          priority?: string | null
          reason?: string | null
          recommended_temp?: number
          start_time?: string
        }
        Relationships: []
      }
      heating_settings: {
        Row: {
          battery_capacity_kwh: number
          car_charging_enabled: boolean | null
          car_min_charge_power_w: number | null
          comfort_temp: number
          consumer_priority: string | null
          created_at: string
          eco_temp: number
          estrich_storage_enabled: boolean | null
          floor_heating_response_hours: number | null
          hotwater_enabled: boolean | null
          hotwater_min_surplus_w: number | null
          hotwater_power_w: number | null
          hotwater_schedule_end: string | null
          hotwater_schedule_start: string | null
          id: string
          latitude: number | null
          longitude: number | null
          min_battery_soc: number
          min_switch_interval_min: number | null
          night_temp: number
          preheat_hours: number
          pv_capacity_kwp: number
          pv_surplus_threshold_off: number | null
          pv_surplus_threshold_on: number | null
          roof_azimuth: number | null
          roof_declination: number | null
          target_battery_soc: number
          updated_at: string
        }
        Insert: {
          battery_capacity_kwh?: number
          car_charging_enabled?: boolean | null
          car_min_charge_power_w?: number | null
          comfort_temp?: number
          consumer_priority?: string | null
          created_at?: string
          eco_temp?: number
          estrich_storage_enabled?: boolean | null
          floor_heating_response_hours?: number | null
          hotwater_enabled?: boolean | null
          hotwater_min_surplus_w?: number | null
          hotwater_power_w?: number | null
          hotwater_schedule_end?: string | null
          hotwater_schedule_start?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          min_battery_soc?: number
          min_switch_interval_min?: number | null
          night_temp?: number
          preheat_hours?: number
          pv_capacity_kwp?: number
          pv_surplus_threshold_off?: number | null
          pv_surplus_threshold_on?: number | null
          roof_azimuth?: number | null
          roof_declination?: number | null
          target_battery_soc?: number
          updated_at?: string
        }
        Update: {
          battery_capacity_kwh?: number
          car_charging_enabled?: boolean | null
          car_min_charge_power_w?: number | null
          comfort_temp?: number
          consumer_priority?: string | null
          created_at?: string
          eco_temp?: number
          estrich_storage_enabled?: boolean | null
          floor_heating_response_hours?: number | null
          hotwater_enabled?: boolean | null
          hotwater_min_surplus_w?: number | null
          hotwater_power_w?: number | null
          hotwater_schedule_end?: string | null
          hotwater_schedule_start?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          min_battery_soc?: number
          min_switch_interval_min?: number | null
          night_temp?: number
          preheat_hours?: number
          pv_capacity_kwp?: number
          pv_surplus_threshold_off?: number | null
          pv_surplus_threshold_on?: number | null
          roof_azimuth?: number | null
          roof_declination?: number | null
          target_battery_soc?: number
          updated_at?: string
        }
        Relationships: []
      }
      hourly_aggregates: {
        Row: {
          avg_power: number
          created_at: string
          hour_start: string
          id: string
          max_power: number
          min_power: number
          reading_count: number
          total_energy_in: number
          total_energy_out: number
        }
        Insert: {
          avg_power: number
          created_at?: string
          hour_start: string
          id?: string
          max_power: number
          min_power: number
          reading_count?: number
          total_energy_in: number
          total_energy_out: number
        }
        Update: {
          avg_power?: number
          created_at?: string
          hour_start?: string
          id?: string
          max_power?: number
          min_power?: number
          reading_count?: number
          total_energy_in?: number
          total_energy_out?: number
        }
        Relationships: []
      }
      pv_forecasts: {
        Row: {
          created_at: string
          date: string
          expected_kwh: number
          fetched_at: string
          hourly_watts: Json | null
          id: string
          sunrise: string | null
          sunset: string | null
        }
        Insert: {
          created_at?: string
          date: string
          expected_kwh?: number
          fetched_at?: string
          hourly_watts?: Json | null
          id?: string
          sunrise?: string | null
          sunset?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          expected_kwh?: number
          fetched_at?: string
          hourly_watts?: Json | null
          id?: string
          sunrise?: string | null
          sunset?: string | null
        }
        Relationships: []
      }
      room_heating_logs: {
        Row: {
          created_at: string | null
          current_temp: number | null
          duration_minutes: number | null
          energy_estimate_wh: number | null
          event_type: string
          id: string
          pv_surplus_w: number | null
          room_id: string
          target_temp: number | null
          timestamp: string | null
        }
        Insert: {
          created_at?: string | null
          current_temp?: number | null
          duration_minutes?: number | null
          energy_estimate_wh?: number | null
          event_type: string
          id?: string
          pv_surplus_w?: number | null
          room_id: string
          target_temp?: number | null
          timestamp?: string | null
        }
        Update: {
          created_at?: string | null
          current_temp?: number | null
          duration_minutes?: number | null
          energy_estimate_wh?: number | null
          event_type?: string
          id?: string
          pv_surplus_w?: number | null
          room_id?: string
          target_temp?: number | null
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_heating_logs_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_recommendations: {
        Row: {
          created_at: string | null
          date: string
          end_time: string
          id: string
          period_number: number | null
          priority: string | null
          reason: string | null
          recommended_temp: number
          room_id: string
          start_time: string
        }
        Insert: {
          created_at?: string | null
          date: string
          end_time: string
          id?: string
          period_number?: number | null
          priority?: string | null
          reason?: string | null
          recommended_temp: number
          room_id: string
          start_time: string
        }
        Update: {
          created_at?: string | null
          date?: string
          end_time?: string
          id?: string
          period_number?: number | null
          priority?: string | null
          reason?: string | null
          recommended_temp?: number
          room_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_recommendations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          automation_enabled: boolean | null
          avg_heating_cycles_per_day: number | null
          comfort_temp: number | null
          created_at: string | null
          current_temp: number | null
          eco_temp: number | null
          estimated_kwh_per_degree: number | null
          floor_area_m2: number | null
          has_solar_gain: boolean | null
          heating_power_w: number | null
          id: string
          is_heating: boolean | null
          last_auto_change: string | null
          last_heating_duration_min: number | null
          last_thermostat_sync: string | null
          name: string
          night_temp: number | null
          orientation: string | null
          priority: number | null
          pv_auto_active: boolean | null
          pv_auto_enabled: boolean | null
          pv_auto_last_change: string | null
          target_temp: number | null
          thermostat_ip: string | null
          thermostat_type: string | null
          tuya_device_id: string | null
          updated_at: string | null
        }
        Insert: {
          automation_enabled?: boolean | null
          avg_heating_cycles_per_day?: number | null
          comfort_temp?: number | null
          created_at?: string | null
          current_temp?: number | null
          eco_temp?: number | null
          estimated_kwh_per_degree?: number | null
          floor_area_m2?: number | null
          has_solar_gain?: boolean | null
          heating_power_w?: number | null
          id?: string
          is_heating?: boolean | null
          last_auto_change?: string | null
          last_heating_duration_min?: number | null
          last_thermostat_sync?: string | null
          name: string
          night_temp?: number | null
          orientation?: string | null
          priority?: number | null
          pv_auto_active?: boolean | null
          pv_auto_enabled?: boolean | null
          pv_auto_last_change?: string | null
          target_temp?: number | null
          thermostat_ip?: string | null
          thermostat_type?: string | null
          tuya_device_id?: string | null
          updated_at?: string | null
        }
        Update: {
          automation_enabled?: boolean | null
          avg_heating_cycles_per_day?: number | null
          comfort_temp?: number | null
          created_at?: string | null
          current_temp?: number | null
          eco_temp?: number | null
          estimated_kwh_per_degree?: number | null
          floor_area_m2?: number | null
          has_solar_gain?: boolean | null
          heating_power_w?: number | null
          id?: string
          is_heating?: boolean | null
          last_auto_change?: string | null
          last_heating_duration_min?: number | null
          last_thermostat_sync?: string | null
          name?: string
          night_temp?: number | null
          orientation?: string | null
          priority?: number | null
          pv_auto_active?: boolean | null
          pv_auto_enabled?: boolean | null
          pv_auto_last_change?: string | null
          target_temp?: number | null
          thermostat_ip?: string | null
          thermostat_type?: string | null
          tuya_device_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      smartfox_settings: {
        Row: {
          api_path: string | null
          created_at: string
          fronius_ip: string | null
          fronius_is_active: boolean | null
          id: string
          is_active: boolean | null
          polling_interval: number
          smartfox_ip: string
          updated_at: string
        }
        Insert: {
          api_path?: string | null
          created_at?: string
          fronius_ip?: string | null
          fronius_is_active?: boolean | null
          id?: string
          is_active?: boolean | null
          polling_interval?: number
          smartfox_ip: string
          updated_at?: string
        }
        Update: {
          api_path?: string | null
          created_at?: string
          fronius_ip?: string | null
          fronius_is_active?: boolean | null
          id?: string
          is_active?: boolean | null
          polling_interval?: number
          smartfox_ip?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
