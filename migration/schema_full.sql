-- =====================================================================
-- smartfox-insight-ai : Vollstaendiges public-Schema (DDL only, keine Daten)
-- Direkt im SQL-Editor des neuen Supabase-Projekts ausfuehren.
-- Keine Custom-Enums vorhanden. Keine Sequences (alle IDs = uuid).
--
-- IMPORT-REIHENFOLGE der Daten (wegen Foreign Keys):
--   1) ZUERST:  rooms
--   2) DANACH:  alle uebrigen Tabellen (FKs zeigen ausschliesslich auf rooms)
--      -> api_errors, learned_policies, learning_events, room_heating_logs,
--         room_ml_features, room_recommendations, room_temperature_samples,
--         thermostat_commands
--   3) Tabellen ohne FK koennen jederzeit geladen werden.
-- =====================================================================

-- =====================================================================
-- 1) TABELLEN
-- =====================================================================

CREATE TABLE public."ai_daily_plans" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "plan_date" date NOT NULL,
  "source" text NOT NULL DEFAULT 'claude-haiku'::text,
  "overall_strategy" text,
  "time_blocks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "rooms" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "raw_plan" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "ai_daily_plans_plan_date_key" UNIQUE (plan_date)
);

CREATE TABLE public."ai_parameter_decisions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "parameter_scope" text NOT NULL,
  "room_id" uuid,
  "parameter_key" text NOT NULL,
  "current_value" text,
  "proposed_value" text NOT NULL,
  "reasoning" text,
  "confidence" numeric,
  "context_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expected_outcome" jsonb DEFAULT '{}'::jsonb,
  "decision_mode" text NOT NULL DEFAULT 'shadow'::text,
  "applied_at" timestamp with time zone,
  "applied_by" text,
  "outcome_evaluated_at" timestamp with time zone,
  "actual_outcome" jsonb,
  "outcome_score" numeric,
  "auto_applied" boolean DEFAULT false,
  "rollback_at" timestamp with time zone,
  PRIMARY KEY ("id"),
  CONSTRAINT "ai_parameter_decisions_confidence_check" CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT "ai_parameter_decisions_decision_mode_check" CHECK ((decision_mode = ANY (ARRAY['shadow'::text, 'suggest'::text, 'auto'::text, 'applied'::text, 'rejected'::text]))),
  CONSTRAINT "ai_parameter_decisions_parameter_scope_check" CHECK ((parameter_scope = ANY (ARRAY['global'::text, 'room'::text])))
);

CREATE TABLE public."ai_parameter_whitelist" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "parameter_key" text NOT NULL,
  "scope" text NOT NULL,
  "storage_table" text NOT NULL,
  "storage_column" text NOT NULL,
  "data_type" text NOT NULL,
  "min_value" numeric,
  "max_value" numeric,
  "allowed_values" jsonb,
  "autonomy_level" text NOT NULL DEFAULT 'shadow'::text,
  "enabled" boolean NOT NULL DEFAULT true,
  "description" text,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "ai_parameter_whitelist_parameter_key_scope_key" UNIQUE (parameter_key, scope),
  CONSTRAINT "ai_parameter_whitelist_autonomy_level_check" CHECK ((autonomy_level = ANY (ARRAY['shadow'::text, 'suggest'::text, 'auto'::text]))),
  CONSTRAINT "ai_parameter_whitelist_data_type_check" CHECK ((data_type = ANY (ARRAY['number'::text, 'integer'::text, 'boolean'::text, 'text'::text]))),
  CONSTRAINT "ai_parameter_whitelist_scope_check" CHECK ((scope = ANY (ARRAY['global'::text, 'room'::text])))
);

CREATE TABLE public."api_errors" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "source" text NOT NULL,
  "room_id" uuid,
  "room_name" text,
  "error_type" text NOT NULL,
  "error_message" text,
  "error_code" text,
  "device_id" text,
  "resolved_at" timestamp with time zone,
  "is_acknowledged" boolean DEFAULT false,
  "retry_count" integer DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE public."battery_daily_tracking" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "date" date NOT NULL,
  "soc_at_heating_start" numeric,
  "soc_at_heating_end" numeric,
  "soc_at_morning" numeric,
  "min_soc_during_night" numeric,
  "night_consumption_kwh" numeric,
  "heating_battery_used_kwh" numeric,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "battery_daily_tracking_date_key" UNIQUE (date)
);

CREATE TABLE public."battery_soc_suggestions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "old_value" integer NOT NULL,
  "new_value" integer NOT NULL,
  "pv_forecast_kwh" numeric(6,2),
  "avg_pv_7d_kwh" numeric(6,2),
  "soc_end_of_day" integer,
  "reason_text" text,
  "status" text NOT NULL DEFAULT 'pending'::text,
  "decided_at" timestamp with time zone,
  "decided_by" text DEFAULT 'user'::text,
  PRIMARY KEY ("id"),
  CONSTRAINT "battery_soc_suggestions_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'dismissed'::text])))
);

CREATE TABLE public."consumer_logs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "consumer_type" text NOT NULL,
  "start_time" timestamp with time zone NOT NULL,
  "end_time" timestamp with time zone,
  "duration_minutes" integer,
  "avg_power_w" integer,
  "max_power_w" integer,
  "total_energy_wh" integer,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE public."daily_pattern_scores" (
  "date" date NOT NULL,
  "sig_weather" text NOT NULL,
  "sig_pv_bucket" text NOT NULL,
  "sig_temp_bucket" text NOT NULL,
  "sig_weekday" text NOT NULL,
  "kpi_self_consumption_ratio" numeric,
  "kpi_pv_heating_coverage" numeric,
  "kpi_grid_import_kwh" numeric,
  "kpi_battery_end_soc" numeric,
  "pv_kwh" numeric,
  "feed_in_kwh" numeric,
  "heating_kwh" numeric,
  "expected_pv_kwh" numeric,
  "avg_outdoor_c" numeric,
  "score" numeric NOT NULL DEFAULT 0,
  "rank_in_signature" integer,
  "settings_snapshot" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("date"),
  CONSTRAINT "daily_pattern_scores_sig_pv_bucket_check" CHECK ((sig_pv_bucket = ANY (ARRAY['low'::text, 'mid'::text, 'high'::text]))),
  CONSTRAINT "daily_pattern_scores_sig_temp_bucket_check" CHECK ((sig_temp_bucket = ANY (ARRAY['cold'::text, 'mild'::text, 'warm'::text]))),
  CONSTRAINT "daily_pattern_scores_sig_weather_check" CHECK ((sig_weather = ANY (ARRAY['sunny'::text, 'mixed'::text, 'cloudy'::text]))),
  CONSTRAINT "daily_pattern_scores_sig_weekday_check" CHECK ((sig_weekday = ANY (ARRAY['workday'::text, 'weekend'::text])))
);

CREATE TABLE public."daily_patterns" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "date" date NOT NULL,
  "peak_power" numeric NOT NULL,
  "peak_time" timestamp with time zone,
  "avg_power" numeric NOT NULL,
  "total_energy_in" numeric NOT NULL,
  "total_energy_out" numeric NOT NULL,
  "net_energy" numeric NOT NULL,
  "pattern_type" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "daily_patterns_date_key" UNIQUE (date)
);

CREATE TABLE public."data_retention_settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "polling_interval_seconds" integer DEFAULT 300,
  "raw_data_retention_days" integer DEFAULT 7,
  "hourly_retention_days" integer DEFAULT 90,
  "auto_cleanup_enabled" boolean DEFAULT true,
  "last_cleanup_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE public."detected_patterns" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "pattern_name" text NOT NULL,
  "description" text,
  "confidence" numeric,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "avg_power" numeric,
  "occurrence_days" text[],
  "ai_analysis" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE public."energy_daily_costs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "date" date NOT NULL,
  "energy_in_kwh" numeric NOT NULL DEFAULT 0,
  "energy_out_kwh" numeric NOT NULL DEFAULT 0,
  "pv_energy_kwh" numeric NOT NULL DEFAULT 0,
  "self_consumption_kwh" numeric NOT NULL DEFAULT 0,
  "grid_cost_eur" numeric NOT NULL DEFAULT 0,
  "feed_in_earnings_eur" numeric NOT NULL DEFAULT 0,
  "pv_savings_eur" numeric NOT NULL DEFAULT 0,
  "net_balance_eur" numeric NOT NULL DEFAULT 0,
  "electricity_price_cent" numeric NOT NULL DEFAULT 20.28,
  "feed_in_price_cent" numeric NOT NULL DEFAULT 8.00,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "energy_daily_costs_date_key" UNIQUE (date)
);

CREATE TABLE public."energy_price_history" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "valid_from" date NOT NULL,
  "valid_to" date,
  "electricity_price_cent" numeric NOT NULL,
  "feed_in_price_cent" numeric NOT NULL,
  "electricity_base_fee_year_eur" numeric NOT NULL DEFAULT 0,
  "source" text NOT NULL DEFAULT 'manual'::text,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "energy_price_history_source_check" CHECK ((source = ANY (ARRAY['manual'::text, 'salzburg_ag_auto'::text, 'oemag_auto'::text, 'initial'::text])))
);

CREATE TABLE public."energy_readings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  "power_io" numeric NOT NULL,
  "energy_in" numeric NOT NULL,
  "energy_out" numeric NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "battery_soc" numeric,
  "pv_power" numeric,
  "consumption" numeric,
  "battery_power" numeric,
  PRIMARY KEY ("id")
);

CREATE TABLE public."heating_recommendations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "date" date NOT NULL,
  "period_number" integer NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "recommended_temp" numeric NOT NULL,
  "reason" text,
  "expected_pv_surplus" numeric,
  "priority" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ai_source" text,
  "priority_rank" integer,
  "reasoning" text,
  "valid_for_date" date,
  PRIMARY KEY ("id"),
  CONSTRAINT "heating_recommendations_date_period_number_key" UNIQUE (date, period_number),
  CONSTRAINT "heating_recommendations_period_number_check" CHECK (((period_number >= 1) AND (period_number <= 6))),
  CONSTRAINT "heating_recommendations_priority_check" CHECK ((priority = ANY (ARRAY['battery'::text, 'heating'::text, 'conservation'::text])))
);

CREATE TABLE public."heating_settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "pv_capacity_kwp" numeric NOT NULL DEFAULT 15.8,
  "battery_capacity_kwh" numeric NOT NULL DEFAULT 13.8,
  "min_battery_soc" numeric NOT NULL DEFAULT 20,
  "target_battery_soc" numeric NOT NULL DEFAULT 80,
  "comfort_temp" numeric NOT NULL DEFAULT 21,
  "eco_temp" numeric NOT NULL DEFAULT 19,
  "night_temp" numeric NOT NULL DEFAULT 18,
  "preheat_hours" numeric NOT NULL DEFAULT 2,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "latitude" numeric DEFAULT 47.24983,
  "longitude" numeric DEFAULT 12.25415,
  "roof_azimuth" integer DEFAULT 0,
  "roof_declination" integer DEFAULT 35,
  "pv_surplus_threshold_on" integer DEFAULT 500,
  "pv_surplus_threshold_off" integer DEFAULT 200,
  "min_switch_interval_min" integer DEFAULT 5,
  "consumer_priority" text DEFAULT 'battery,heating,car'::text,
  "floor_heating_response_hours" numeric DEFAULT 2,
  "estrich_storage_enabled" boolean DEFAULT true,
  "car_charging_enabled" boolean DEFAULT false,
  "car_min_charge_power_w" integer DEFAULT 1380,
  "hotwater_enabled" boolean DEFAULT true,
  "hotwater_power_w" integer DEFAULT 2800,
  "hotwater_schedule_start" text DEFAULT '10:00'::text,
  "hotwater_schedule_end" text DEFAULT '16:00'::text,
  "hotwater_min_surplus_w" integer DEFAULT 1000,
  "heating_type" text DEFAULT 'direct_electric'::text,
  "total_heating_power_w" integer,
  "night_cycling_enabled" boolean DEFAULT true,
  "avg_night_cycles_per_room" integer DEFAULT 4,
  "electricity_price_kwh_cent" numeric(6,2) DEFAULT 20.28,
  "electricity_base_fee_year_eur" numeric(6,2) DEFAULT 36.00,
  "feed_in_price_kwh_cent" numeric(6,2) DEFAULT 8.00,
  "night_start_time" time without time zone DEFAULT '22:00:00'::time without time zone,
  "night_end_time" time without time zone DEFAULT '06:00:00'::time without time zone,
  "power_budget_enabled" boolean DEFAULT true,
  "max_grid_heating_power_w" integer DEFAULT 2000,
  "power_budget_tolerance_w" integer DEFAULT 200,
  "room_rotation_minutes" integer DEFAULT 30,
  "min_room_pause_minutes" integer DEFAULT 15,
  "pv_boost_temp_delta" numeric DEFAULT 2,
  "night_heating_mode" text DEFAULT 'frost_only'::text,
  "micro_budget_enabled" boolean DEFAULT true,
  "micro_budget_min_battery_soc" integer DEFAULT 80,
  "micro_heat_duration_min" integer DEFAULT 5,
  "battery_reserve_for_night_soc" integer DEFAULT 60,
  "battery_buffer_enabled" boolean DEFAULT true,
  "battery_buffer_bonus_w" integer DEFAULT 500,
  "tolerant_deactivation_enabled" boolean DEFAULT true,
  "heating_min_battery_soc" integer DEFAULT 80,
  "heating_soc_gate_mode" text DEFAULT 'strict'::text,
  "analysis_daily_enabled" boolean DEFAULT true,
  "analysis_daily_time" time without time zone DEFAULT '03:30:00'::time without time zone,
  "analysis_weekly_enabled" boolean DEFAULT true,
  "analysis_weekly_weekday" integer DEFAULT 0,
  "analysis_weekly_time" time without time zone DEFAULT '04:00:00'::time without time zone,
  "analysis_monthly_enabled" boolean DEFAULT true,
  "analysis_monthly_dom" integer DEFAULT 1,
  "analysis_monthly_time" time without time zone DEFAULT '04:30:00'::time without time zone,
  "analysis_match_today_enabled" boolean DEFAULT true,
  "analysis_match_today_time" time without time zone DEFAULT '05:30:00'::time without time zone,
  "pattern_recall_strength" integer DEFAULT 50,
  "battery_soc_suggestion_enabled" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("id")
);

CREATE TABLE public."hourly_aggregates" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "hour_start" timestamp with time zone NOT NULL,
  "avg_power" numeric NOT NULL,
  "max_power" numeric NOT NULL,
  "min_power" numeric NOT NULL,
  "total_energy_in" numeric NOT NULL,
  "total_energy_out" numeric NOT NULL,
  "reading_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "hourly_aggregates_hour_start_key" UNIQUE (hour_start)
);

CREATE TABLE public."learned_policies" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "hour_of_day" integer NOT NULL,
  "recommended_action" text NOT NULL DEFAULT 'keep'::text,
  "recommended_temp" numeric,
  "avg_reward" numeric DEFAULT 0,
  "sample_count" integer DEFAULT 0,
  "success_rate" numeric DEFAULT 0,
  "avg_grid_import_wh" numeric DEFAULT 0,
  "avg_pv_usage_ratio" numeric DEFAULT 0,
  "conditions" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "learning_confidence" double precision DEFAULT 0,
  PRIMARY KEY ("id"),
  CONSTRAINT "learned_policies_room_id_hour_of_day_key" UNIQUE (room_id, hour_of_day)
);

CREATE TABLE public."learning_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  "decision_type" text NOT NULL,
  "room_id" uuid,
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "action" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "outcome" jsonb,
  "reward" numeric,
  "reward_breakdown" jsonb,
  "evaluated_at" timestamp with time zone,
  "is_evaluated" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE public."price_suggestions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "source" text NOT NULL,
  "field" text NOT NULL,
  "old_value" numeric,
  "new_value" numeric NOT NULL,
  "effective_date" date NOT NULL DEFAULT CURRENT_DATE,
  "status" text NOT NULL DEFAULT 'pending'::text,
  "raw_excerpt" text,
  "decided_at" timestamp with time zone,
  "decided_by" text,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "price_suggestions_field_check" CHECK ((field = ANY (ARRAY['electricity_price_cent'::text, 'feed_in_price_cent'::text, 'electricity_base_fee_year_eur'::text]))),
  CONSTRAINT "price_suggestions_source_check" CHECK ((source = ANY (ARRAY['salzburg_ag'::text, 'oemag'::text]))),
  CONSTRAINT "price_suggestions_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'dismissed'::text])))
);

CREATE TABLE public."pv_forecasts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "date" date NOT NULL,
  "expected_kwh" numeric NOT NULL DEFAULT 0,
  "hourly_watts" jsonb DEFAULT '{}'::jsonb,
  "sunrise" time without time zone,
  "sunset" time without time zone,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "pv_forecasts_date_key" UNIQUE (date)
);

CREATE TABLE public."room_heating_logs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now(),
  "event_type" text NOT NULL,
  "current_temp" numeric,
  "target_temp" numeric,
  "duration_minutes" integer,
  "energy_estimate_wh" integer,
  "pv_surplus_w" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "consumption_at_start_w" integer,
  "consumption_during_avg_w" integer,
  PRIMARY KEY ("id")
);

CREATE TABLE public."room_kpi_15min" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "bucket_start" timestamp with time zone NOT NULL,
  "grid_import_wh" numeric DEFAULT 0,
  "pv_used_wh" numeric DEFAULT 0,
  "heating_minutes" integer DEFAULT 1,
  "temp_start" numeric,
  "temp_end" numeric,
  "target_temp" numeric,
  "target_reached" boolean,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "room_kpi_15min_room_id_bucket_start_key" UNIQUE (room_id, bucket_start)
);

CREATE TABLE public."room_ml_features" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "date" date NOT NULL,
  "heat_loss_rate_deg_per_hour" numeric,
  "heating_rate_deg_per_hour" numeric,
  "energy_per_degree_wh" numeric,
  "solar_gain_factor" numeric,
  "optimal_solar_hours" text[],
  "avg_heating_duration_min" numeric,
  "avg_cycles_per_day" numeric,
  "preheat_duration_for_1deg_min" numeric,
  "pv_heating_ratio" numeric,
  "battery_dependency_ratio" numeric,
  "grid_import_ratio" numeric,
  "confidence" numeric DEFAULT 0,
  "sample_count" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "room_ml_features_room_id_date_key" UNIQUE (room_id, date)
);

CREATE TABLE public."room_recommendations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "date" date NOT NULL,
  "period_number" integer,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "recommended_temp" numeric NOT NULL,
  "reason" text,
  "priority" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "room_recommendations_room_date_period_unique" UNIQUE (room_id, date, period_number),
  CONSTRAINT "room_recommendations_priority_check" CHECK ((priority = ANY (ARRAY['heat_now'::text, 'preheat'::text, 'hold'::text, 'reduce'::text, 'off'::text])))
);

CREATE TABLE public."room_temperature_samples" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "timestamp" timestamp with time zone NOT NULL DEFAULT now(),
  "temperature" numeric NOT NULL,
  "is_heating" boolean NOT NULL DEFAULT false,
  "pv_power_w" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE public."rooms" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "thermostat_type" text DEFAULT 'TGP508'::text,
  "orientation" text,
  "has_solar_gain" boolean DEFAULT false,
  "floor_area_m2" numeric,
  "comfort_temp" numeric DEFAULT 21,
  "eco_temp" numeric DEFAULT 19,
  "night_temp" numeric DEFAULT 17,
  "priority" integer DEFAULT 2,
  "heating_power_w" numeric,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tuya_device_id" text,
  "thermostat_ip" text,
  "current_temp" numeric,
  "target_temp" numeric,
  "is_heating" boolean DEFAULT false,
  "pv_auto_enabled" boolean DEFAULT false,
  "last_thermostat_sync" timestamp with time zone,
  "pv_auto_active" boolean DEFAULT false,
  "pv_auto_last_change" timestamp with time zone,
  "estimated_kwh_per_degree" numeric,
  "last_heating_duration_min" integer,
  "avg_heating_cycles_per_day" numeric,
  "automation_enabled" boolean DEFAULT false,
  "last_auto_change" timestamp with time zone,
  "calculated_power_w" numeric,
  "power_calculation_confidence" numeric DEFAULT 0,
  "power_samples" integer DEFAULT 0,
  "last_power_calculation" timestamp with time zone,
  "calculated_solar_gain_factor" numeric DEFAULT 0,
  "solar_gain_confidence" numeric DEFAULT 0,
  "solar_gain_samples" integer DEFAULT 0,
  "calculated_heat_loss_rate" numeric DEFAULT 0,
  "last_solar_analysis" timestamp with time zone,
  "manual_override_until" timestamp with time zone,
  "solar_limit_temp" numeric(4,2),
  "solar_heating_temp" numeric,
  "local_key" text,
  "thermostat_local_ip" text,
  "last_heating_start" timestamp with time zone,
  "last_heating_end" timestamp with time zone,
  "heating_paused_reason" text,
  "pv_boost_max_temp" numeric,
  "comfort_saturated_at" timestamp with time zone,
  "work_state" text,
  PRIMARY KEY ("id"),
  CONSTRAINT "rooms_priority_unique" UNIQUE (priority),
  CONSTRAINT "rooms_orientation_check" CHECK ((orientation = ANY (ARRAY['nord'::text, 'süd'::text, 'ost'::text, 'west'::text]))),
  CONSTRAINT "rooms_priority_check" CHECK (((priority >= 1) AND (priority <= 12)))
);

CREATE TABLE public."service_health" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "service_name" text NOT NULL,
  "last_sync" timestamp with time zone,
  "sync_count" integer DEFAULT 0,
  "last_error_count" integer DEFAULT 0,
  "devices_configured" integer DEFAULT 0,
  "devices_ok" integer DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "service_health_service_name_key" UNIQUE (service_name)
);

CREATE TABLE public."smartfox_settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "smartfox_ip" text NOT NULL,
  "polling_interval" integer NOT NULL DEFAULT 60,
  "api_path" text DEFAULT '/power'::text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "fronius_ip" text,
  "fronius_is_active" boolean DEFAULT false,
  PRIMARY KEY ("id")
);

CREATE TABLE public."solar_heating_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now(),
  "temp_start" numeric NOT NULL,
  "temp_current" numeric NOT NULL,
  "temp_change_per_hour" numeric,
  "duration_minutes" integer,
  "pv_power_w" integer,
  "is_heating" boolean DEFAULT false,
  "solar_gain_detected" boolean DEFAULT false,
  "heat_source" text,
  "confidence" numeric DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "solar_heating_events_heat_source_check" CHECK ((heat_source = ANY (ARRAY['solar'::text, 'heating'::text, 'both'::text, 'none'::text])))
);

CREATE TABLE public."system_settings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "system_settings_key_key" UNIQUE (key)
);

CREATE TABLE public."thermostat_commands" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "room_id" uuid NOT NULL,
  "command" text NOT NULL,
  "value" numeric,
  "status" text DEFAULT 'pending'::text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "executed_at" timestamp with time zone,
  "value_text" text,
  PRIMARY KEY ("id")
);

CREATE TABLE public."weather_data" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "timestamp" timestamp with time zone NOT NULL,
  "temperature_c" numeric,
  "apparent_temperature_c" numeric,
  "humidity_percent" numeric,
  "cloud_cover_percent" numeric,
  "wind_speed_kmh" numeric,
  "precipitation_mm" numeric,
  "is_day" boolean,
  "direct_radiation_wm2" numeric,
  "diffuse_radiation_wm2" numeric,
  "source" text DEFAULT 'open-meteo'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "weather_data_timestamp_key" UNIQUE ("timestamp")
);


-- =====================================================================
-- 2) FOREIGN KEYS (nach dem Anlegen aller Tabellen)
-- =====================================================================

ALTER TABLE public."api_errors" ADD CONSTRAINT "api_errors_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public."learned_policies" ADD CONSTRAINT "learned_policies_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public."learning_events" ADD CONSTRAINT "learning_events_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public."room_heating_logs" ADD CONSTRAINT "room_heating_logs_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public."room_ml_features" ADD CONSTRAINT "room_ml_features_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public."room_recommendations" ADD CONSTRAINT "room_recommendations_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public."room_temperature_samples" ADD CONSTRAINT "room_temperature_samples_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE public."thermostat_commands" ADD CONSTRAINT "thermostat_commands_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

-- =====================================================================
-- 3) INDEXE (Primary-Key- & Unique-Indexe sind oben inline enthalten)
-- =====================================================================

CREATE INDEX idx_ai_daily_plans_date ON public.ai_daily_plans USING btree (plan_date DESC);
CREATE INDEX idx_ai_decisions_created ON public.ai_parameter_decisions USING btree (created_at DESC);
CREATE INDEX idx_ai_decisions_unevaluated ON public.ai_parameter_decisions USING btree (created_at) WHERE (outcome_evaluated_at IS NULL);
CREATE INDEX idx_ai_decisions_param ON public.ai_parameter_decisions USING btree (parameter_key, created_at DESC);
CREATE INDEX idx_api_errors_resolved ON public.api_errors USING btree (resolved_at) WHERE (resolved_at IS NULL);
CREATE INDEX idx_api_errors_room ON public.api_errors USING btree (room_id, created_at DESC);
CREATE INDEX idx_api_errors_created ON public.api_errors USING btree (created_at DESC);
CREATE INDEX idx_api_errors_created_at ON public.api_errors USING btree (created_at DESC);
CREATE INDEX idx_api_errors_unresolved ON public.api_errors USING btree (resolved_at) WHERE (resolved_at IS NULL);
CREATE UNIQUE INDEX uq_battery_soc_suggestions_single_pending ON public.battery_soc_suggestions USING btree (status) WHERE (status = 'pending'::text);
CREATE INDEX idx_battery_soc_suggestions_status_created ON public.battery_soc_suggestions USING btree (status, created_at DESC);
CREATE INDEX idx_consumer_logs_type_time ON public.consumer_logs USING btree (consumer_type, start_time DESC);
CREATE INDEX idx_consumer_logs_active ON public.consumer_logs USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_consumer_logs_start_time ON public.consumer_logs USING btree (start_time DESC);
CREATE INDEX idx_daily_pattern_scores_signature ON public.daily_pattern_scores USING btree (sig_weather, sig_pv_bucket, sig_temp_bucket, sig_weekday, score DESC);
CREATE INDEX idx_daily_patterns_date ON public.daily_patterns USING btree (date DESC);
CREATE INDEX idx_energy_price_history_valid_from ON public.energy_price_history USING btree (valid_from DESC);
CREATE INDEX idx_energy_readings_timestamp ON public.energy_readings USING btree ("timestamp" DESC);
CREATE INDEX idx_heating_recommendations_ai_source_date ON public.heating_recommendations USING btree (ai_source, valid_for_date DESC);
CREATE INDEX idx_hourly_aggregates_hour ON public.hourly_aggregates USING btree (hour_start DESC);
CREATE INDEX idx_hourly_aggregates_hour_start ON public.hourly_aggregates USING btree (hour_start DESC);
CREATE INDEX idx_learned_policies_room_hour ON public.learned_policies USING btree (room_id, hour_of_day);
CREATE INDEX idx_learning_events_unevaluated ON public.learning_events USING btree (is_evaluated) WHERE (is_evaluated = false);
CREATE INDEX idx_learning_events_room_evaluated ON public.learning_events USING btree (room_id, is_evaluated) WHERE ((is_evaluated = true) AND (reward IS NOT NULL));
CREATE INDEX idx_learning_events_room ON public.learning_events USING btree (room_id);
CREATE INDEX idx_learning_events_created_at ON public.learning_events USING btree (created_at DESC);
CREATE INDEX idx_learning_events_timestamp ON public.learning_events USING btree ("timestamp" DESC);
CREATE INDEX idx_learning_events_created ON public.learning_events USING btree (created_at DESC);
CREATE INDEX idx_learning_events_decision_type ON public.learning_events USING btree (decision_type);
CREATE INDEX idx_price_suggestions_status ON public.price_suggestions USING btree (status, fetched_at DESC);
CREATE INDEX idx_pv_forecasts_date ON public.pv_forecasts USING btree (date);
CREATE INDEX idx_room_heating_logs_timestamp_type ON public.room_heating_logs USING btree ("timestamp" DESC, event_type);
CREATE INDEX idx_room_heating_logs_room_id ON public.room_heating_logs USING btree (room_id);
CREATE INDEX idx_room_heating_logs_timestamp ON public.room_heating_logs USING btree ("timestamp" DESC);
CREATE INDEX idx_room_kpi_15min_room_id_bucket ON public.room_kpi_15min USING btree (room_id, bucket_start DESC);
CREATE INDEX idx_room_kpi_15min_bucket ON public.room_kpi_15min USING btree (bucket_start DESC);
CREATE INDEX idx_room_ml_features_date ON public.room_ml_features USING btree (date DESC);
CREATE INDEX idx_room_ml_features_room ON public.room_ml_features USING btree (room_id);
CREATE INDEX idx_room_recommendations_room_id ON public.room_recommendations USING btree (room_id);
CREATE INDEX idx_room_recommendations_date ON public.room_recommendations USING btree (date);
CREATE INDEX idx_room_temp_samples_room_timestamp ON public.room_temperature_samples USING btree (room_id, "timestamp" DESC);
CREATE INDEX idx_room_temp_samples_timestamp ON public.room_temperature_samples USING btree ("timestamp" DESC);
CREATE INDEX idx_room_temperature_samples_timestamp ON public.room_temperature_samples USING btree ("timestamp" DESC);
CREATE INDEX idx_service_health_name ON public.service_health USING btree (service_name);
CREATE INDEX idx_solar_heating_events_room_timestamp ON public.solar_heating_events USING btree (room_id, "timestamp" DESC);
CREATE INDEX idx_solar_heating_events_timestamp ON public.solar_heating_events USING btree ("timestamp" DESC);
CREATE INDEX idx_thermostat_commands_status ON public.thermostat_commands USING btree (status) WHERE (status = 'pending'::text);
CREATE INDEX idx_weather_data_timestamp ON public.weather_data USING btree ("timestamp" DESC);
