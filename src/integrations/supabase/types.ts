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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      enrichments: {
        Row: {
          error: string | null
          generated_at: string | null
          golden_description: string | null
          golden_features: Json
          golden_name: string | null
          hidden_images: Json
          id: string
          image_meta: Json
          match_type: Database["public"]["Enums"]["match_type"]
          matched_term: string | null
          model: string | null
          picked_urls: string[]
          previous: Json | null
          project_id: string
          quality: Json | null
          source_product_id: string
          status: Database["public"]["Enums"]["enrichment_status"]
          updated_at: string
        }
        Insert: {
          error?: string | null
          generated_at?: string | null
          golden_description?: string | null
          golden_features?: Json
          golden_name?: string | null
          hidden_images?: Json
          id?: string
          image_meta?: Json
          match_type?: Database["public"]["Enums"]["match_type"]
          matched_term?: string | null
          model?: string | null
          picked_urls?: string[]
          previous?: Json | null
          project_id: string
          quality?: Json | null
          source_product_id: string
          status?: Database["public"]["Enums"]["enrichment_status"]
          updated_at?: string
        }
        Update: {
          error?: string | null
          generated_at?: string | null
          golden_description?: string | null
          golden_features?: Json
          golden_name?: string | null
          hidden_images?: Json
          id?: string
          image_meta?: Json
          match_type?: Database["public"]["Enums"]["match_type"]
          matched_term?: string | null
          model?: string | null
          picked_urls?: string[]
          previous?: Json | null
          project_id?: string
          quality?: Json | null
          source_product_id?: string
          status?: Database["public"]["Enums"]["enrichment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichments_source_product_id_fkey"
            columns: ["source_product_id"]
            isOneToOne: true
            referencedRelation: "source_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sources: {
        Row: {
          created_at: string
          description: string | null
          extra_images: Json
          id: string
          images: Json
          project_id: string
          raw: Json
          title: string | null
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          extra_images?: Json
          id?: string
          images?: Json
          project_id: string
          raw?: Json
          title?: string | null
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          extra_images?: Json
          id?: string
          images?: Json
          project_id?: string
          raw?: Json
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          blacklist: string[]
          code_column: string
          created_at: string
          custom_prompt: string
          ean_column: string
          id: string
          id_column: string
          include_extra_images: boolean
          name: string
          name_column: string
          strategy: Database["public"]["Enums"]["mapping_strategy"]
          updated_at: string
          user_id: string
        }
        Insert: {
          blacklist?: string[]
          code_column?: string
          created_at?: string
          custom_prompt?: string
          ean_column?: string
          id?: string
          id_column?: string
          include_extra_images?: boolean
          name: string
          name_column?: string
          strategy?: Database["public"]["Enums"]["mapping_strategy"]
          updated_at?: string
          user_id: string
        }
        Update: {
          blacklist?: string[]
          code_column?: string
          created_at?: string
          custom_prompt?: string
          ean_column?: string
          id?: string
          id_column?: string
          include_extra_images?: boolean
          name?: string
          name_column?: string
          strategy?: Database["public"]["Enums"]["mapping_strategy"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      search_results: {
        Row: {
          created_at: string
          id: string
          organic_urls: Json
          project_id: string
          term: string
        }
        Insert: {
          created_at?: string
          id?: string
          organic_urls?: Json
          project_id: string
          term: string
        }
        Update: {
          created_at?: string
          id?: string
          organic_urls?: Json
          project_id?: string
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      source_products: {
        Row: {
          created_at: string
          ean: string | null
          ext_id: string | null
          id: string
          kod: string | null
          nazwa: string | null
          project_id: string
          raw: Json
        }
        Insert: {
          created_at?: string
          ean?: string | null
          ext_id?: string | null
          id?: string
          kod?: string | null
          nazwa?: string | null
          project_id: string
          raw?: Json
        }
        Update: {
          created_at?: string
          ean?: string | null
          ext_id?: string | null
          id?: string
          kod?: string | null
          nazwa?: string | null
          project_id?: string
          raw?: Json
        }
        Relationships: [
          {
            foreignKeyName: "source_products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      enrichment_status: "PENDING" | "MATCHED" | "GENERATED" | "FAILED"
      mapping_strategy: "EAN" | "NAZWA" | "HYBRID"
      match_type: "EAN_MATCH" | "NAME_MATCH" | "HYBRID_MATCH" | "NO_MATCH"
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
    Enums: {
      enrichment_status: ["PENDING", "MATCHED", "GENERATED", "FAILED"],
      mapping_strategy: ["EAN", "NAZWA", "HYBRID"],
      match_type: ["EAN_MATCH", "NAME_MATCH", "HYBRID_MATCH", "NO_MATCH"],
    },
  },
} as const
