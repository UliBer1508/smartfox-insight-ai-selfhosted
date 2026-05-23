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
      ai_daily_plans: {
        Row: {
          created_at: string
          id: string
          overall_strategy: string | null
          plan_date: string
          raw_plan: Json | null
          rooms: Json
          source: string
          time_blocks: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          overall_strategy?: string | null
          plan_date: string
          raw_plan?: Json | null
          rooms?: Json
          source?: string
          time_blocks?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          overall_strategy?: string | null
          plan_date?: string
          raw_plan?: Json | null
          rooms?: Json
          source?: string
          time_blocks?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ai_parameter_decisions: {
        Row: {
          actual_outcome: Json | null
          applied_at: string | null
          applied_by: string | null
          auto_applied: boolean | null
          confidence: number | null
          context_snapshot: Json
          created_at: string
          current_value: string | null
          decision_mode: string
          expected_outcome: Json | null
          id: string
          outcome_evaluated_at: string | null
          outcome_score: number | null
          parameter_key: string
          parameter_scope: string
          proposed_value: string
          reasoning: string | null
          rollback_at: string | null
          room_id: string | null
        }
        Insert: {
          actual_outcome?: Json | null
          applied_at?: string | null
          applied_by?: string | null
          auto_applied?: boolean | null
          confidence?: number | null
          context_snapshot?: Json
          created_at?: string
          current_value?: string | null
          decision_mode?: string
          expected_outcome?: Json | null
          id?: string
          outcome_evaluated_at?: string | null
          outcome_score?: number | null
          parameter_key: string
          parameter_scope: string
          proposed_value: string
          reasoning?: string | null
          rollback_at?: string | null
          room_id?: string | null
        }
        Update: {
          actual_outcome?: Json | null
          applied_at?: string | null
          applied_by?: string | null
          auto_applied?: boolean | null
          confidence?: number | null
          context_snapshot?: Json
          created_at?: string
          current_value?: string | null
          decision_mode?: string
          expected_outcome?: Json | null
          id?: string
          outcome_evaluated_at?: string | null
          outcome_score?: number | null
          parameter_key?: string
          parameter_scope?: string
          proposed_value?: string
          reasoning?: string | null
          rollback_at?: string | null
          room_id?: string | null
        }
        Relationships: []
      }
      ai_parameter_whitelist: {
        Row: {
          allowed_values: Json | null
          autonomy_level: string
          created_at: string
          data_type: string
          description: string | null
          enabled: boolean
          id: string
          max_value: number | null
          min_value: number | null
          notes: string | null
          parameter_key: string
          scope: string
          storage_column: string
          storage_table: string
          updated_at: string
        }
        Insert: {
          allowed_values?: Json | null
          autonomy_level?: string
          created_at?: string
          data_type: string
          description?: string | null
          enabled?: boolean
          id?: string
          max_value?: number | null
          min_value?: number | null
          notes?: string | null
          parameter_key: string
          scope: string
          storage_column: string
          storage_table: string
          updated_at?: string
        }
        Update: {
          allowed_values?: Json | null
          autonomy_level?: string
          created_at?: string
          data_type?: string
          description?: string | null
          enabled?: boolean
          id?: string
          max_value?: number | null
          min_value?: number | null
          notes?: string | null
          parameter_key?: string
          scope?: string
          storage_column?: string
          storage_table?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_errors: {
        Row: {
          created_at: string
          device_id: string | null
          error_code: string | null
          error_message: string | null
          error_type: string
          id: string
          is_acknowledged: boolean | null
          resolved_at: string | null
          retry_count: number | null
          room_id: string | null
          room_name: string | null
          source: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          error_code?: string | null
          error_message?: string | null
          error_type: string
          id?: string
          is_acknowledged?: boolean | null
          resolved_at?: string | null
          retry_count?: number | null
          room_id?: string | null
          room_name?: string | null
          source: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          error_code?: string | null
          error_message?: string | null
          error_type?: string
          id?: string
          is_acknowledged?: boolean | null
          resolved_at?: string | null
          retry_count?: number | null
          room_id?: string | null
          room_name?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_errors_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_errors_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      battery_daily_tracking: {
        Row: {
          created_at: string | null
          date: string
          heating_battery_used_kwh: number | null
          id: string
          min_soc_during_night: number | null
          night_consumption_kwh: number | null
          soc_at_heating_end: number | null
          soc_at_heating_start: number | null
          soc_at_morning: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          heating_battery_used_kwh?: number | null
          id?: string
          min_soc_during_night?: number | null
          night_consumption_kwh?: number | null
          soc_at_heating_end?: number | null
          soc_at_heating_start?: number | null
          soc_at_morning?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          heating_battery_used_kwh?: number | null
          id?: string
          min_soc_during_night?: number | null
          night_consumption_kwh?: number | null
          soc_at_heating_end?: number | null
          soc_at_heating_start?: number | null
          soc_at_morning?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      consumer_logs: {
        Row: {
          avg_power_w: number | null
          consumer_type: string
          created_at: string | null
          duration_minutes: number | null
          end_time: string | null
          id: string
          is_active: boolean | null
          max_power_w: number | null
          start_time: string
          total_energy_wh: number | null
        }
        Insert: {
          avg_power_w?: number | null
          consumer_type: string
          created_at?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          id?: string
          is_active?: boolean | null
          max_power_w?: number | null
          start_time: string
          total_energy_wh?: number | null
        }
        Update: {
          avg_power_w?: number | null
          consumer_type?: string
          created_at?: string | null
          duration_minutes?: number | null
          end_time?: string | null
          id?: string
          is_active?: boolean | null
          max_power_w?: number | null
          start_time?: string
          total_energy_wh?: number | null
        }
        Relationships: []
      }
      daily_pattern_scores: {
        Row: {
          avg_outdoor_c: number | null
          created_at: string
          date: string
          expected_pv_kwh: number | null
          feed_in_kwh: number | null
          heating_kwh: number | null
          kpi_battery_end_soc: number | null
          kpi_grid_import_kwh: number | null
          kpi_pv_heating_coverage: number | null
          kpi_self_consumption_ratio: number | null
          pv_kwh: number | null
          rank_in_signature: number | null
          score: number
          settings_snapshot: Json | null
          sig_pv_bucket: string
          sig_temp_bucket: string
          sig_weather: string
          sig_weekday: string
          updated_at: string
        }
        Insert: {
          avg_outdoor_c?: number | null
          created_at?: string
          date: string
          expected_pv_kwh?: number | null
          feed_in_kwh?: number | null
          heating_kwh?: number | null
          kpi_battery_end_soc?: number | null
          kpi_grid_import_kwh?: number | null
          kpi_pv_heating_coverage?: number | null
          kpi_self_consumption_ratio?: number | null
          pv_kwh?: number | null
          rank_in_signature?: number | null
          score?: number
          settings_snapshot?: Json | null
          sig_pv_bucket: string
          sig_temp_bucket: string
          sig_weather: string
          sig_weekday: string
          updated_at?: string
        }
        Update: {
          avg_outdoor_c?: number | null
          created_at?: string
          date?: string
          expected_pv_kwh?: number | null
          feed_in_kwh?: number | null
          heating_kwh?: number | null
          kpi_battery_end_soc?: number | null
          kpi_grid_import_kwh?: number | null
          kpi_pv_heating_coverage?: number | null
          kpi_self_consumption_ratio?: number | null
          pv_kwh?: number | null
          rank_in_signature?: number | null
          score?: number
          settings_snapshot?: Json | null
          sig_pv_bucket?: string
          sig_temp_bucket?: string
          sig_weather?: string
          sig_weekday?: string
          updated_at?: string
        }
        Relationships: []
      }
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
      energy_daily_costs: {
        Row: {
          created_at: string | null
          date: string
          electricity_price_cent: number
          energy_in_kwh: number
          energy_out_kwh: number
          feed_in_earnings_eur: number
          feed_in_price_cent: number
          grid_cost_eur: number
          id: string
          net_balance_eur: number
          pv_energy_kwh: number
          pv_savings_eur: number
          self_consumption_kwh: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          electricity_price_cent?: number
          energy_in_kwh?: number
          energy_out_kwh?: number
          feed_in_earnings_eur?: number
          feed_in_price_cent?: number
          grid_cost_eur?: number
          id?: string
          net_balance_eur?: number
          pv_energy_kwh?: number
          pv_savings_eur?: number
          self_consumption_kwh?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          electricity_price_cent?: number
          energy_in_kwh?: number
          energy_out_kwh?: number
          feed_in_earnings_eur?: number
          feed_in_price_cent?: number
          grid_cost_eur?: number
          id?: string
          net_balance_eur?: number
          pv_energy_kwh?: number
          pv_savings_eur?: number
          self_consumption_kwh?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      energy_readings: {
        Row: {
          battery_power: number | null
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
          battery_power?: number | null
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
          battery_power?: number | null
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
          ai_source: string | null
          created_at: string
          date: string
          end_time: string
          expected_pv_surplus: number | null
          id: string
          period_number: number
          priority: string | null
          priority_rank: number | null
          reason: string | null
          reasoning: string | null
          recommended_temp: number
          start_time: string
          valid_for_date: string | null
        }
        Insert: {
          ai_source?: string | null
          created_at?: string
          date: string
          end_time: string
          expected_pv_surplus?: number | null
          id?: string
          period_number: number
          priority?: string | null
          priority_rank?: number | null
          reason?: string | null
          reasoning?: string | null
          recommended_temp: number
          start_time: string
          valid_for_date?: string | null
        }
        Update: {
          ai_source?: string | null
          created_at?: string
          date?: string
          end_time?: string
          expected_pv_surplus?: number | null
          id?: string
          period_number?: number
          priority?: string | null
          priority_rank?: number | null
          reason?: string | null
          reasoning?: string | null
          recommended_temp?: number
          start_time?: string
          valid_for_date?: string | null
        }
        Relationships: []
      }
      heating_settings: {
        Row: {
          analysis_daily_enabled: boolean | null
          analysis_daily_time: string | null
          analysis_match_today_enabled: boolean | null
          analysis_match_today_time: string | null
          analysis_monthly_dom: number | null
          analysis_monthly_enabled: boolean | null
          analysis_monthly_time: string | null
          analysis_weekly_enabled: boolean | null
          analysis_weekly_time: string | null
          analysis_weekly_weekday: number | null
          avg_night_cycles_per_room: number | null
          battery_buffer_bonus_w: number | null
          battery_buffer_enabled: boolean | null
          battery_capacity_kwh: number
          battery_reserve_for_night_soc: number | null
          car_charging_enabled: boolean | null
          car_min_charge_power_w: number | null
          comfort_temp: number
          consumer_priority: string | null
          created_at: string
          eco_temp: number
          electricity_base_fee_year_eur: number | null
          electricity_price_kwh_cent: number | null
          estrich_storage_enabled: boolean | null
          feed_in_price_kwh_cent: number | null
          floor_heating_response_hours: number | null
          heating_min_battery_soc: number | null
          heating_soc_gate_mode: string | null
          heating_type: string | null
          hotwater_enabled: boolean | null
          hotwater_min_surplus_w: number | null
          hotwater_power_w: number | null
          hotwater_schedule_end: string | null
          hotwater_schedule_start: string | null
          id: string
          latitude: number | null
          longitude: number | null
          max_grid_heating_power_w: number | null
          micro_budget_enabled: boolean | null
          micro_budget_min_battery_soc: number | null
          micro_heat_duration_min: number | null
          min_battery_soc: number
          min_room_pause_minutes: number | null
          min_switch_interval_min: number | null
          night_cycling_enabled: boolean | null
          night_end_time: string | null
          night_heating_mode: string | null
          night_start_time: string | null
          night_temp: number
          pattern_recall_strength: number | null
          power_budget_enabled: boolean | null
          power_budget_tolerance_w: number | null
          preheat_hours: number
          pv_boost_temp_delta: number | null
          pv_capacity_kwp: number
          pv_surplus_threshold_off: number | null
          pv_surplus_threshold_on: number | null
          roof_azimuth: number | null
          roof_declination: number | null
          room_rotation_minutes: number | null
          target_battery_soc: number
          tolerant_deactivation_enabled: boolean | null
          total_heating_power_w: number | null
          updated_at: string
        }
        Insert: {
          analysis_daily_enabled?: boolean | null
          analysis_daily_time?: string | null
          analysis_match_today_enabled?: boolean | null
          analysis_match_today_time?: string | null
          analysis_monthly_dom?: number | null
          analysis_monthly_enabled?: boolean | null
          analysis_monthly_time?: string | null
          analysis_weekly_enabled?: boolean | null
          analysis_weekly_time?: string | null
          analysis_weekly_weekday?: number | null
          avg_night_cycles_per_room?: number | null
          battery_buffer_bonus_w?: number | null
          battery_buffer_enabled?: boolean | null
          battery_capacity_kwh?: number
          battery_reserve_for_night_soc?: number | null
          car_charging_enabled?: boolean | null
          car_min_charge_power_w?: number | null
          comfort_temp?: number
          consumer_priority?: string | null
          created_at?: string
          eco_temp?: number
          electricity_base_fee_year_eur?: number | null
          electricity_price_kwh_cent?: number | null
          estrich_storage_enabled?: boolean | null
          feed_in_price_kwh_cent?: number | null
          floor_heating_response_hours?: number | null
          heating_min_battery_soc?: number | null
          heating_soc_gate_mode?: string | null
          heating_type?: string | null
          hotwater_enabled?: boolean | null
          hotwater_min_surplus_w?: number | null
          hotwater_power_w?: number | null
          hotwater_schedule_end?: string | null
          hotwater_schedule_start?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          max_grid_heating_power_w?: number | null
          micro_budget_enabled?: boolean | null
          micro_budget_min_battery_soc?: number | null
          micro_heat_duration_min?: number | null
          min_battery_soc?: number
          min_room_pause_minutes?: number | null
          min_switch_interval_min?: number | null
          night_cycling_enabled?: boolean | null
          night_end_time?: string | null
          night_heating_mode?: string | null
          night_start_time?: string | null
          night_temp?: number
          pattern_recall_strength?: number | null
          power_budget_enabled?: boolean | null
          power_budget_tolerance_w?: number | null
          preheat_hours?: number
          pv_boost_temp_delta?: number | null
          pv_capacity_kwp?: number
          pv_surplus_threshold_off?: number | null
          pv_surplus_threshold_on?: number | null
          roof_azimuth?: number | null
          roof_declination?: number | null
          room_rotation_minutes?: number | null
          target_battery_soc?: number
          tolerant_deactivation_enabled?: boolean | null
          total_heating_power_w?: number | null
          updated_at?: string
        }
        Update: {
          analysis_daily_enabled?: boolean | null
          analysis_daily_time?: string | null
          analysis_match_today_enabled?: boolean | null
          analysis_match_today_time?: string | null
          analysis_monthly_dom?: number | null
          analysis_monthly_enabled?: boolean | null
          analysis_monthly_time?: string | null
          analysis_weekly_enabled?: boolean | null
          analysis_weekly_time?: string | null
          analysis_weekly_weekday?: number | null
          avg_night_cycles_per_room?: number | null
          battery_buffer_bonus_w?: number | null
          battery_buffer_enabled?: boolean | null
          battery_capacity_kwh?: number
          battery_reserve_for_night_soc?: number | null
          car_charging_enabled?: boolean | null
          car_min_charge_power_w?: number | null
          comfort_temp?: number
          consumer_priority?: string | null
          created_at?: string
          eco_temp?: number
          electricity_base_fee_year_eur?: number | null
          electricity_price_kwh_cent?: number | null
          estrich_storage_enabled?: boolean | null
          feed_in_price_kwh_cent?: number | null
          floor_heating_response_hours?: number | null
          heating_min_battery_soc?: number | null
          heating_soc_gate_mode?: string | null
          heating_type?: string | null
          hotwater_enabled?: boolean | null
          hotwater_min_surplus_w?: number | null
          hotwater_power_w?: number | null
          hotwater_schedule_end?: string | null
          hotwater_schedule_start?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          max_grid_heating_power_w?: number | null
          micro_budget_enabled?: boolean | null
          micro_budget_min_battery_soc?: number | null
          micro_heat_duration_min?: number | null
          min_battery_soc?: number
          min_room_pause_minutes?: number | null
          min_switch_interval_min?: number | null
          night_cycling_enabled?: boolean | null
          night_end_time?: string | null
          night_heating_mode?: string | null
          night_start_time?: string | null
          night_temp?: number
          pattern_recall_strength?: number | null
          power_budget_enabled?: boolean | null
          power_budget_tolerance_w?: number | null
          preheat_hours?: number
          pv_boost_temp_delta?: number | null
          pv_capacity_kwp?: number
          pv_surplus_threshold_off?: number | null
          pv_surplus_threshold_on?: number | null
          roof_azimuth?: number | null
          roof_declination?: number | null
          room_rotation_minutes?: number | null
          target_battery_soc?: number
          tolerant_deactivation_enabled?: boolean | null
          total_heating_power_w?: number | null
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
      learned_policies: {
        Row: {
          avg_grid_import_wh: number | null
          avg_pv_usage_ratio: number | null
          avg_reward: number | null
          conditions: Json | null
          created_at: string | null
          hour_of_day: number
          id: string
          learning_confidence: number | null
          recommended_action: string
          recommended_temp: number | null
          room_id: string
          sample_count: number | null
          success_rate: number | null
          updated_at: string | null
        }
        Insert: {
          avg_grid_import_wh?: number | null
          avg_pv_usage_ratio?: number | null
          avg_reward?: number | null
          conditions?: Json | null
          created_at?: string | null
          hour_of_day: number
          id?: string
          learning_confidence?: number | null
          recommended_action?: string
          recommended_temp?: number | null
          room_id: string
          sample_count?: number | null
          success_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_grid_import_wh?: number | null
          avg_pv_usage_ratio?: number | null
          avg_reward?: number | null
          conditions?: Json | null
          created_at?: string | null
          hour_of_day?: number
          id?: string
          learning_confidence?: number | null
          recommended_action?: string
          recommended_temp?: number | null
          room_id?: string
          sample_count?: number | null
          success_rate?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learned_policies_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learned_policies_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_events: {
        Row: {
          action: Json
          context: Json
          created_at: string | null
          decision_type: string
          evaluated_at: string | null
          id: string
          is_evaluated: boolean | null
          outcome: Json | null
          reward: number | null
          reward_breakdown: Json | null
          room_id: string | null
          timestamp: string
        }
        Insert: {
          action?: Json
          context?: Json
          created_at?: string | null
          decision_type: string
          evaluated_at?: string | null
          id?: string
          is_evaluated?: boolean | null
          outcome?: Json | null
          reward?: number | null
          reward_breakdown?: Json | null
          room_id?: string | null
          timestamp?: string
        }
        Update: {
          action?: Json
          context?: Json
          created_at?: string | null
          decision_type?: string
          evaluated_at?: string | null
          id?: string
          is_evaluated?: boolean | null
          outcome?: Json | null
          reward?: number | null
          reward_breakdown?: Json | null
          room_id?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
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
          consumption_at_start_w: number | null
          consumption_during_avg_w: number | null
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
          consumption_at_start_w?: number | null
          consumption_during_avg_w?: number | null
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
          consumption_at_start_w?: number | null
          consumption_during_avg_w?: number | null
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
          {
            foreignKeyName: "room_heating_logs_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      room_kpi_15min: {
        Row: {
          bucket_start: string
          created_at: string | null
          grid_import_wh: number | null
          heating_minutes: number | null
          id: string
          pv_used_wh: number | null
          room_id: string
          target_reached: boolean | null
          target_temp: number | null
          temp_end: number | null
          temp_start: number | null
        }
        Insert: {
          bucket_start: string
          created_at?: string | null
          grid_import_wh?: number | null
          heating_minutes?: number | null
          id?: string
          pv_used_wh?: number | null
          room_id: string
          target_reached?: boolean | null
          target_temp?: number | null
          temp_end?: number | null
          temp_start?: number | null
        }
        Update: {
          bucket_start?: string
          created_at?: string | null
          grid_import_wh?: number | null
          heating_minutes?: number | null
          id?: string
          pv_used_wh?: number | null
          room_id?: string
          target_reached?: boolean | null
          target_temp?: number | null
          temp_end?: number | null
          temp_start?: number | null
        }
        Relationships: []
      }
      room_ml_features: {
        Row: {
          avg_cycles_per_day: number | null
          avg_heating_duration_min: number | null
          battery_dependency_ratio: number | null
          confidence: number | null
          created_at: string | null
          date: string
          energy_per_degree_wh: number | null
          grid_import_ratio: number | null
          heat_loss_rate_deg_per_hour: number | null
          heating_rate_deg_per_hour: number | null
          id: string
          optimal_solar_hours: string[] | null
          preheat_duration_for_1deg_min: number | null
          pv_heating_ratio: number | null
          room_id: string
          sample_count: number | null
          solar_gain_factor: number | null
          updated_at: string | null
        }
        Insert: {
          avg_cycles_per_day?: number | null
          avg_heating_duration_min?: number | null
          battery_dependency_ratio?: number | null
          confidence?: number | null
          created_at?: string | null
          date: string
          energy_per_degree_wh?: number | null
          grid_import_ratio?: number | null
          heat_loss_rate_deg_per_hour?: number | null
          heating_rate_deg_per_hour?: number | null
          id?: string
          optimal_solar_hours?: string[] | null
          preheat_duration_for_1deg_min?: number | null
          pv_heating_ratio?: number | null
          room_id: string
          sample_count?: number | null
          solar_gain_factor?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_cycles_per_day?: number | null
          avg_heating_duration_min?: number | null
          battery_dependency_ratio?: number | null
          confidence?: number | null
          created_at?: string | null
          date?: string
          energy_per_degree_wh?: number | null
          grid_import_ratio?: number | null
          heat_loss_rate_deg_per_hour?: number | null
          heating_rate_deg_per_hour?: number | null
          id?: string
          optimal_solar_hours?: string[] | null
          preheat_duration_for_1deg_min?: number | null
          pv_heating_ratio?: number | null
          room_id?: string
          sample_count?: number | null
          solar_gain_factor?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_ml_features_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_ml_features_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
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
          {
            foreignKeyName: "room_recommendations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      room_temperature_samples: {
        Row: {
          created_at: string | null
          id: string
          is_heating: boolean
          pv_power_w: number | null
          room_id: string
          temperature: number
          timestamp: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_heating?: boolean
          pv_power_w?: number | null
          room_id: string
          temperature: number
          timestamp?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_heating?: boolean
          pv_power_w?: number | null
          room_id?: string
          temperature?: number
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_temperature_samples_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_temperature_samples_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          automation_enabled: boolean | null
          avg_heating_cycles_per_day: number | null
          calculated_heat_loss_rate: number | null
          calculated_power_w: number | null
          calculated_solar_gain_factor: number | null
          comfort_saturated_at: string | null
          comfort_temp: number | null
          created_at: string | null
          current_temp: number | null
          eco_temp: number | null
          estimated_kwh_per_degree: number | null
          floor_area_m2: number | null
          has_solar_gain: boolean | null
          heating_paused_reason: string | null
          heating_power_w: number | null
          id: string
          is_heating: boolean | null
          last_auto_change: string | null
          last_heating_duration_min: number | null
          last_heating_end: string | null
          last_heating_start: string | null
          last_power_calculation: string | null
          last_solar_analysis: string | null
          last_thermostat_sync: string | null
          local_key: string | null
          manual_override_until: string | null
          name: string
          night_temp: number | null
          orientation: string | null
          power_calculation_confidence: number | null
          power_samples: number | null
          priority: number | null
          pv_auto_active: boolean | null
          pv_auto_enabled: boolean | null
          pv_auto_last_change: string | null
          pv_boost_max_temp: number | null
          solar_gain_confidence: number | null
          solar_gain_samples: number | null
          solar_heating_temp: number | null
          solar_limit_temp: number | null
          target_temp: number | null
          thermostat_ip: string | null
          thermostat_local_ip: string | null
          thermostat_type: string | null
          tuya_device_id: string | null
          updated_at: string | null
          work_state: string | null
        }
        Insert: {
          automation_enabled?: boolean | null
          avg_heating_cycles_per_day?: number | null
          calculated_heat_loss_rate?: number | null
          calculated_power_w?: number | null
          calculated_solar_gain_factor?: number | null
          comfort_saturated_at?: string | null
          comfort_temp?: number | null
          created_at?: string | null
          current_temp?: number | null
          eco_temp?: number | null
          estimated_kwh_per_degree?: number | null
          floor_area_m2?: number | null
          has_solar_gain?: boolean | null
          heating_paused_reason?: string | null
          heating_power_w?: number | null
          id?: string
          is_heating?: boolean | null
          last_auto_change?: string | null
          last_heating_duration_min?: number | null
          last_heating_end?: string | null
          last_heating_start?: string | null
          last_power_calculation?: string | null
          last_solar_analysis?: string | null
          last_thermostat_sync?: string | null
          local_key?: string | null
          manual_override_until?: string | null
          name: string
          night_temp?: number | null
          orientation?: string | null
          power_calculation_confidence?: number | null
          power_samples?: number | null
          priority?: number | null
          pv_auto_active?: boolean | null
          pv_auto_enabled?: boolean | null
          pv_auto_last_change?: string | null
          pv_boost_max_temp?: number | null
          solar_gain_confidence?: number | null
          solar_gain_samples?: number | null
          solar_heating_temp?: number | null
          solar_limit_temp?: number | null
          target_temp?: number | null
          thermostat_ip?: string | null
          thermostat_local_ip?: string | null
          thermostat_type?: string | null
          tuya_device_id?: string | null
          updated_at?: string | null
          work_state?: string | null
        }
        Update: {
          automation_enabled?: boolean | null
          avg_heating_cycles_per_day?: number | null
          calculated_heat_loss_rate?: number | null
          calculated_power_w?: number | null
          calculated_solar_gain_factor?: number | null
          comfort_saturated_at?: string | null
          comfort_temp?: number | null
          created_at?: string | null
          current_temp?: number | null
          eco_temp?: number | null
          estimated_kwh_per_degree?: number | null
          floor_area_m2?: number | null
          has_solar_gain?: boolean | null
          heating_paused_reason?: string | null
          heating_power_w?: number | null
          id?: string
          is_heating?: boolean | null
          last_auto_change?: string | null
          last_heating_duration_min?: number | null
          last_heating_end?: string | null
          last_heating_start?: string | null
          last_power_calculation?: string | null
          last_solar_analysis?: string | null
          last_thermostat_sync?: string | null
          local_key?: string | null
          manual_override_until?: string | null
          name?: string
          night_temp?: number | null
          orientation?: string | null
          power_calculation_confidence?: number | null
          power_samples?: number | null
          priority?: number | null
          pv_auto_active?: boolean | null
          pv_auto_enabled?: boolean | null
          pv_auto_last_change?: string | null
          pv_boost_max_temp?: number | null
          solar_gain_confidence?: number | null
          solar_gain_samples?: number | null
          solar_heating_temp?: number | null
          solar_limit_temp?: number | null
          target_temp?: number | null
          thermostat_ip?: string | null
          thermostat_local_ip?: string | null
          thermostat_type?: string | null
          tuya_device_id?: string | null
          updated_at?: string | null
          work_state?: string | null
        }
        Relationships: []
      }
      service_health: {
        Row: {
          created_at: string
          devices_configured: number | null
          devices_ok: number | null
          id: string
          last_error_count: number | null
          last_sync: string | null
          service_name: string
          sync_count: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          devices_configured?: number | null
          devices_ok?: number | null
          id?: string
          last_error_count?: number | null
          last_sync?: string | null
          service_name: string
          sync_count?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          devices_configured?: number | null
          devices_ok?: number | null
          id?: string
          last_error_count?: number | null
          last_sync?: string | null
          service_name?: string
          sync_count?: number | null
          updated_at?: string
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
      solar_heating_events: {
        Row: {
          confidence: number | null
          created_at: string | null
          duration_minutes: number | null
          heat_source: string | null
          id: string
          is_heating: boolean | null
          pv_power_w: number | null
          room_id: string
          solar_gain_detected: boolean | null
          temp_change_per_hour: number | null
          temp_current: number
          temp_start: number
          timestamp: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          duration_minutes?: number | null
          heat_source?: string | null
          id?: string
          is_heating?: boolean | null
          pv_power_w?: number | null
          room_id: string
          solar_gain_detected?: boolean | null
          temp_change_per_hour?: number | null
          temp_current: number
          temp_start: number
          timestamp?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          duration_minutes?: number | null
          heat_source?: string | null
          id?: string
          is_heating?: boolean | null
          pv_power_w?: number | null
          room_id?: string
          solar_gain_detected?: boolean | null
          temp_change_per_hour?: number | null
          temp_current?: number
          temp_start?: number
          timestamp?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      thermostat_commands: {
        Row: {
          command: string
          created_at: string | null
          error_message: string | null
          executed_at: string | null
          id: string
          room_id: string
          status: string | null
          value: number | null
          value_text: string | null
        }
        Insert: {
          command: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          room_id: string
          status?: string | null
          value?: number | null
          value_text?: string | null
        }
        Update: {
          command?: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          room_id?: string
          status?: string | null
          value?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "thermostat_commands_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thermostat_commands_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms_public"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_data: {
        Row: {
          apparent_temperature_c: number | null
          cloud_cover_percent: number | null
          created_at: string | null
          diffuse_radiation_wm2: number | null
          direct_radiation_wm2: number | null
          humidity_percent: number | null
          id: string
          is_day: boolean | null
          precipitation_mm: number | null
          source: string | null
          temperature_c: number | null
          timestamp: string
          wind_speed_kmh: number | null
        }
        Insert: {
          apparent_temperature_c?: number | null
          cloud_cover_percent?: number | null
          created_at?: string | null
          diffuse_radiation_wm2?: number | null
          direct_radiation_wm2?: number | null
          humidity_percent?: number | null
          id?: string
          is_day?: boolean | null
          precipitation_mm?: number | null
          source?: string | null
          temperature_c?: number | null
          timestamp: string
          wind_speed_kmh?: number | null
        }
        Update: {
          apparent_temperature_c?: number | null
          cloud_cover_percent?: number | null
          created_at?: string | null
          diffuse_radiation_wm2?: number | null
          direct_radiation_wm2?: number | null
          humidity_percent?: number | null
          id?: string
          is_day?: boolean | null
          precipitation_mm?: number | null
          source?: string | null
          temperature_c?: number | null
          timestamp?: string
          wind_speed_kmh?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      rooms_public: {
        Row: {
          automation_enabled: boolean | null
          avg_heating_cycles_per_day: number | null
          calculated_heat_loss_rate: number | null
          calculated_power_w: number | null
          calculated_solar_gain_factor: number | null
          comfort_temp: number | null
          created_at: string | null
          current_temp: number | null
          eco_temp: number | null
          estimated_kwh_per_degree: number | null
          floor_area_m2: number | null
          has_solar_gain: boolean | null
          heating_paused_reason: string | null
          heating_power_w: number | null
          id: string | null
          is_heating: boolean | null
          last_auto_change: string | null
          last_heating_duration_min: number | null
          last_heating_end: string | null
          last_heating_start: string | null
          last_power_calculation: string | null
          last_solar_analysis: string | null
          last_thermostat_sync: string | null
          manual_override_until: string | null
          name: string | null
          night_temp: number | null
          orientation: string | null
          power_calculation_confidence: number | null
          power_samples: number | null
          priority: number | null
          pv_auto_active: boolean | null
          pv_auto_enabled: boolean | null
          pv_auto_last_change: string | null
          pv_boost_max_temp: number | null
          solar_gain_confidence: number | null
          solar_gain_samples: number | null
          solar_heating_temp: number | null
          solar_limit_temp: number | null
          target_temp: number | null
          thermostat_type: string | null
          updated_at: string | null
        }
        Insert: {
          automation_enabled?: boolean | null
          avg_heating_cycles_per_day?: number | null
          calculated_heat_loss_rate?: number | null
          calculated_power_w?: number | null
          calculated_solar_gain_factor?: number | null
          comfort_temp?: number | null
          created_at?: string | null
          current_temp?: number | null
          eco_temp?: number | null
          estimated_kwh_per_degree?: number | null
          floor_area_m2?: number | null
          has_solar_gain?: boolean | null
          heating_paused_reason?: string | null
          heating_power_w?: number | null
          id?: string | null
          is_heating?: boolean | null
          last_auto_change?: string | null
          last_heating_duration_min?: number | null
          last_heating_end?: string | null
          last_heating_start?: string | null
          last_power_calculation?: string | null
          last_solar_analysis?: string | null
          last_thermostat_sync?: string | null
          manual_override_until?: string | null
          name?: string | null
          night_temp?: number | null
          orientation?: string | null
          power_calculation_confidence?: number | null
          power_samples?: number | null
          priority?: number | null
          pv_auto_active?: boolean | null
          pv_auto_enabled?: boolean | null
          pv_auto_last_change?: string | null
          pv_boost_max_temp?: number | null
          solar_gain_confidence?: number | null
          solar_gain_samples?: number | null
          solar_heating_temp?: number | null
          solar_limit_temp?: number | null
          target_temp?: number | null
          thermostat_type?: string | null
          updated_at?: string | null
        }
        Update: {
          automation_enabled?: boolean | null
          avg_heating_cycles_per_day?: number | null
          calculated_heat_loss_rate?: number | null
          calculated_power_w?: number | null
          calculated_solar_gain_factor?: number | null
          comfort_temp?: number | null
          created_at?: string | null
          current_temp?: number | null
          eco_temp?: number | null
          estimated_kwh_per_degree?: number | null
          floor_area_m2?: number | null
          has_solar_gain?: boolean | null
          heating_paused_reason?: string | null
          heating_power_w?: number | null
          id?: string | null
          is_heating?: boolean | null
          last_auto_change?: string | null
          last_heating_duration_min?: number | null
          last_heating_end?: string | null
          last_heating_start?: string | null
          last_power_calculation?: string | null
          last_solar_analysis?: string | null
          last_thermostat_sync?: string | null
          manual_override_until?: string | null
          name?: string | null
          night_temp?: number | null
          orientation?: string | null
          power_calculation_confidence?: number | null
          power_samples?: number | null
          priority?: number | null
          pv_auto_active?: boolean | null
          pv_auto_enabled?: boolean | null
          pv_auto_last_change?: string | null
          pv_boost_max_temp?: number | null
          solar_gain_confidence?: number | null
          solar_gain_samples?: number | null
          solar_heating_temp?: number | null
          solar_limit_temp?: number | null
          target_temp?: number | null
          thermostat_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cleanup_ai_parameter_decisions: { Args: never; Returns: number }
      cleanup_old_data: { Args: never; Returns: undefined }
      expire_stale_thermostat_commands: { Args: never; Returns: number }
      get_heating_history: {
        Args: { days_back?: number }
        Returns: {
          cycles: number
          local_date: string
          room_id: string
          room_name: string
          total_energy_wh: number
          total_minutes: number
        }[]
      }
      get_ml_follow_rate: {
        Args: { days_back?: number }
        Returns: {
          day: string
          followed: number
          overridden: number
          reward_when_followed: number
          reward_when_overridden: number
          total_with_ml: number
        }[]
      }
      get_weekly_energy_summary: {
        Args: { days_back?: number }
        Returns: {
          avg_outdoor_c: number
          avg_power: number
          date: string
          energy_in_kwh: number
          energy_out_kwh: number
          feed_in_kwh: number
          heating_kwh: number
          peak_power: number
          pv_kwh: number
          reading_count: number
        }[]
      }
      match_today_pattern: {
        Args: { today_signature: Json; top_n?: number }
        Returns: {
          date: string
          kpi_pv_heating_coverage: number
          kpi_self_consumption_ratio: number
          match_dimensions: number
          match_quality: string
          score: number
          settings_snapshot: Json
          sig_pv_bucket: string
          sig_temp_bucket: string
          sig_weather: string
          sig_weekday: string
        }[]
      }
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
