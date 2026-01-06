export interface DataRetentionSettings {
  id?: string;
  polling_interval_seconds: number;
  raw_data_retention_days: number;
  hourly_retention_days: number;
  auto_cleanup_enabled: boolean;
  last_cleanup_at?: string;
  created_at?: string;
  updated_at?: string;
}
