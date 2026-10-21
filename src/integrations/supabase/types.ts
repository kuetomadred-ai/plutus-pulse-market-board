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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      pf_audit_log: {
        Row: {
          action: string | null
          actor: string | null
          created_at: string
          details: string | null
          entity: string | null
          event_id: string | null
          id: number
          user_id: string
        }
        Insert: {
          action?: string | null
          actor?: string | null
          created_at?: string
          details?: string | null
          entity?: string | null
          event_id?: string | null
          id?: never
          user_id?: string
        }
        Update: {
          action?: string | null
          actor?: string | null
          created_at?: string
          details?: string | null
          entity?: string | null
          event_id?: string | null
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      pf_email_queue: {
        Row: {
          body: string | null
          created_at: string
          id: number
          level: string | null
          notification_id: string | null
          recipient_email: string | null
          status: string | null
          subject: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: never
          level?: string | null
          notification_id?: string | null
          recipient_email?: string | null
          status?: string | null
          subject?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: never
          level?: string | null
          notification_id?: string | null
          recipient_email?: string | null
          status?: string | null
          subject?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pf_engine_accounts: {
        Row: {
          balance: number
          challenge_status: string
          created_at: string
          daily_loss_pct: number | null
          day_key: string
          day_start_balance: number | null
          fail_reason: string | null
          id: string
          initial_balance: number
          leverage: number
          max_dd_pct: number | null
          max_margin_pct: number
          min_equity: number | null
          phase: number
          profit_target_pct: number | null
          program: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance: number
          challenge_status?: string
          created_at?: string
          daily_loss_pct?: number | null
          day_key?: string
          day_start_balance?: number | null
          fail_reason?: string | null
          id: string
          initial_balance: number
          leverage?: number
          max_dd_pct?: number | null
          max_margin_pct?: number
          min_equity?: number | null
          phase?: number
          profit_target_pct?: number | null
          program?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          challenge_status?: string
          created_at?: string
          daily_loss_pct?: number | null
          day_key?: string
          day_start_balance?: number | null
          fail_reason?: string | null
          id?: string
          initial_balance?: number
          leverage?: number
          max_dd_pct?: number | null
          max_margin_pct?: number
          min_equity?: number | null
          phase?: number
          profit_target_pct?: number | null
          program?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pf_engine_instruments: {
        Row: {
          contract_size: number
          enabled: boolean
          symbol: string
          tick_size: number
          tick_value: number
          updated_at: string
        }
        Insert: {
          contract_size?: number
          enabled?: boolean
          symbol: string
          tick_size: number
          tick_value: number
          updated_at?: string
        }
        Update: {
          contract_size?: number
          enabled?: boolean
          symbol?: string
          tick_size?: number
          tick_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      pf_engine_ledger: {
        Row: {
          account_id: string
          amount: number
          balance_after: number
          created_at: string
          details: Json
          event: string
          id: number
          position_id: string | null
          request_id: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          balance_after: number
          created_at?: string
          details?: Json
          event: string
          id?: never
          position_id?: string | null
          request_id?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          balance_after?: number
          created_at?: string
          details?: Json
          event?: string
          id?: never
          position_id?: string | null
          request_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pf_engine_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pf_engine_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pf_engine_ledger_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "pf_engine_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      pf_engine_orders: {
        Row: {
          account_id: string
          created_at: string
          id: string
          lots: number
          order_type: string
          reason: string | null
          request_id: string
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          trigger_price: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          lots: number
          order_type: string
          reason?: string | null
          request_id: string
          side: string
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          trigger_price?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          lots?: number
          order_type?: string
          reason?: string | null
          request_id?: string
          side?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          trigger_price?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pf_engine_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pf_engine_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pf_engine_orders_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "pf_engine_instruments"
            referencedColumns: ["symbol"]
          },
        ]
      }
      pf_engine_positions: {
        Row: {
          account_id: string
          close_reason: string | null
          closed_at: string | null
          entry_price: number
          exit_price: number | null
          id: string
          lots: number
          opened_at: string
          order_id: string | null
          realized_pnl: number | null
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          user_id: string
        }
        Insert: {
          account_id: string
          close_reason?: string | null
          closed_at?: string | null
          entry_price: number
          exit_price?: number | null
          id?: string
          lots: number
          opened_at?: string
          order_id?: string | null
          realized_pnl?: number | null
          side: string
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          user_id: string
        }
        Update: {
          account_id?: string
          close_reason?: string | null
          closed_at?: string | null
          entry_price?: number
          exit_price?: number | null
          id?: string
          lots?: number
          opened_at?: string
          order_id?: string | null
          realized_pnl?: number | null
          side?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pf_engine_positions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pf_engine_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pf_engine_positions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pf_engine_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pf_engine_positions_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "pf_engine_instruments"
            referencedColumns: ["symbol"]
          },
        ]
      }
      pf_engine_quotes: {
        Row: {
          ask: number
          bid: number
          quote_at: string
          received_at: string
          symbol: string
        }
        Insert: {
          ask: number
          bid: number
          quote_at: string
          received_at?: string
          symbol: string
        }
        Update: {
          ask?: number
          bid?: number
          quote_at?: string
          received_at?: string
          symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "pf_engine_quotes_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: true
            referencedRelation: "pf_engine_instruments"
            referencedColumns: ["symbol"]
          },
        ]
      }
      pf_engine_trades_history: {
        Row: {
          account_id: string
          close_reason: string
          closed_at: string
          entry_price: number
          exit_price: number
          id: string
          lots: number
          opened_at: string
          position_id: string | null
          realized_pnl: number
          side: string
          symbol: string
          user_id: string
        }
        Insert: {
          account_id: string
          close_reason: string
          closed_at?: string
          entry_price: number
          exit_price: number
          id?: string
          lots: number
          opened_at: string
          position_id?: string | null
          realized_pnl: number
          side: string
          symbol: string
          user_id: string
        }
        Update: {
          account_id?: string
          close_reason?: string
          closed_at?: string
          entry_price?: number
          exit_price?: number
          id?: string
          lots?: number
          opened_at?: string
          position_id?: string | null
          realized_pnl?: number
          side?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pf_engine_trades_history_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pf_engine_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pf_engine_trades_history_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "pf_engine_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pf_engine_trades_history_symbol_fkey"
            columns: ["symbol"]
            isOneToOne: false
            referencedRelation: "pf_engine_instruments"
            referencedColumns: ["symbol"]
          },
        ]
      }
      pf_firm: {
        Row: {
          blob: Json
          id: string
          updated_at: string
        }
        Insert: {
          blob?: Json
          id: string
          updated_at?: string
        }
        Update: {
          blob?: Json
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pf_users_data: {
        Row: {
          blob: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          blob?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          blob?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      pf_engine_cancel_order: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: {
          account_id: string
          created_at: string
          id: string
          lots: number
          order_type: string
          reason: string | null
          request_id: string
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          trigger_price: number | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pf_engine_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pf_engine_close_at: {
        Args: {
          p_position_id: string
          p_price: number
          p_reason: string
          p_request_id?: string
        }
        Returns: number
      }
      pf_engine_close_partial: {
        Args: {
          p_close_lots: number
          p_position_id: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      pf_engine_close_position: {
        Args: { p_position_id: string; p_request_id: string; p_user_id: string }
        Returns: Json
      }
      pf_engine_equity: { Args: { p_account_id: string }; Returns: number }
      pf_engine_evaluate_account: {
        Args: { p_account_id: string }
        Returns: string
      }
      pf_engine_evaluate_all: { Args: never; Returns: number }
      pf_engine_modify_order: {
        Args: {
          p_order_id: string
          p_sl: number
          p_tp: number
          p_trigger: number
          p_user_id: string
        }
        Returns: {
          account_id: string
          created_at: string
          id: string
          lots: number
          order_type: string
          reason: string | null
          request_id: string
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          trigger_price: number | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pf_engine_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pf_engine_modify_position: {
        Args: {
          p_position_id: string
          p_sl: number
          p_tp: number
          p_user_id: string
        }
        Returns: {
          account_id: string
          close_reason: string | null
          closed_at: string | null
          entry_price: number
          exit_price: number | null
          id: string
          lots: number
          opened_at: string
          order_id: string | null
          realized_pnl: number | null
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pf_engine_positions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pf_engine_place_order: {
        Args: {
          p_account_id: string
          p_lots: number
          p_order_type: string
          p_request_id: string
          p_side: string
          p_sl?: number
          p_symbol: string
          p_tp?: number
          p_trigger?: number
          p_user_id: string
        }
        Returns: Json
      }
      pf_engine_process_tick: {
        Args: {
          p_ask: number
          p_bid: number
          p_quote_at: string
          p_symbol: string
        }
        Returns: number
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
