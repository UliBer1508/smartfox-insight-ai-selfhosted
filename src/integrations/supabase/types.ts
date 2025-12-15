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
          created_at: string
          energy_in: number
          energy_out: number
          id: string
          power_io: number
          timestamp: string
        }
        Insert: {
          created_at?: string
          energy_in: number
          energy_out: number
          id?: string
          power_io: number
          timestamp?: string
        }
        Update: {
          created_at?: string
          energy_in?: number
          energy_out?: number
          id?: string
          power_io?: number
          timestamp?: string
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
      smartfox_settings: {
        Row: {
          api_path: string | null
          created_at: string
          id: string
          is_active: boolean | null
          polling_interval: number
          smartfox_ip: string
          updated_at: string
        }
        Insert: {
          api_path?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          polling_interval?: number
          smartfox_ip: string
          updated_at?: string
        }
        Update: {
          api_path?: string | null
          created_at?: string
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
