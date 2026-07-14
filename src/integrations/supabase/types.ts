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
      bulk_job_events: {
        Row: {
          created_at: string
          details: Json
          id: string
          job_id: string
          level: string
          message: string
          project_id: string
          source_product_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          job_id: string
          level?: string
          message: string
          project_id: string
          source_product_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          job_id?: string
          level?: string
          message?: string
          project_id?: string
          source_product_id?: string | null
        }
        Relationships: []
      }
      bulk_jobs: {
        Row: {
          cancel_requested: boolean
          created_at: string
          failed_count: number
          finished_at: string | null
          id: string
          items: Json
          kind: Database["public"]["Enums"]["bulk_job_kind"]
          last_error: string | null
          payload: Json | null
          processed_count: number
          project_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["bulk_job_status"]
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_requested?: boolean
          created_at?: string
          failed_count?: number
          finished_at?: string | null
          id?: string
          items?: Json
          kind: Database["public"]["Enums"]["bulk_job_kind"]
          last_error?: string | null
          payload?: Json | null
          processed_count?: number
          project_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["bulk_job_status"]
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_requested?: boolean
          created_at?: string
          failed_count?: number
          finished_at?: string | null
          id?: string
          items?: Json
          kind?: Database["public"]["Enums"]["bulk_job_kind"]
          last_error?: string | null
          payload?: Json | null
          processed_count?: number
          project_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["bulk_job_status"]
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_feedback: {
        Row: {
          author_name: string | null
          body: string
          created_at: string
          id: string
          kind: string
          product_id: string | null
          project_id: string
          resolved: boolean
          share_token: string | null
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          kind: string
          product_id?: string | null
          project_id: string
          resolved?: boolean
          share_token?: string | null
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          product_id?: string | null
          project_id?: string
          resolved?: boolean
          share_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_feedback_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "source_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_feedback_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichments: {
        Row: {
          ai_gallery_urls: Json
          allegro_description: string | null
          allegro_generated_at: string | null
          data_sufficiency: string | null
          error: string | null
          generated_at: string | null
          golden_description: string | null
          golden_features: Json
          golden_meta_description: string | null
          golden_name: string | null
          golden_seo_keywords: Json | null
          golden_slug: string | null
          hidden_images: Json
          id: string
          image_meta: Json
          image_scores: Json
          match_type: Database["public"]["Enums"]["match_type"]
          matched_term: string | null
          media_classification: Json
          model: string | null
          picked_urls: string[]
          pinned_main_url: string | null
          previous: Json | null
          project_id: string
          quality: Json | null
          regenerated_main_image: string | null
          rescrape_rounds: number
          score_breakdown: Json | null
          source_product_id: string
          status: Database["public"]["Enums"]["enrichment_status"]
          updated_at: string
        }
        Insert: {
          ai_gallery_urls?: Json
          allegro_description?: string | null
          allegro_generated_at?: string | null
          data_sufficiency?: string | null
          error?: string | null
          generated_at?: string | null
          golden_description?: string | null
          golden_features?: Json
          golden_meta_description?: string | null
          golden_name?: string | null
          golden_seo_keywords?: Json | null
          golden_slug?: string | null
          hidden_images?: Json
          id?: string
          image_meta?: Json
          image_scores?: Json
          match_type?: Database["public"]["Enums"]["match_type"]
          matched_term?: string | null
          media_classification?: Json
          model?: string | null
          picked_urls?: string[]
          pinned_main_url?: string | null
          previous?: Json | null
          project_id: string
          quality?: Json | null
          regenerated_main_image?: string | null
          rescrape_rounds?: number
          score_breakdown?: Json | null
          source_product_id: string
          status?: Database["public"]["Enums"]["enrichment_status"]
          updated_at?: string
        }
        Update: {
          ai_gallery_urls?: Json
          allegro_description?: string | null
          allegro_generated_at?: string | null
          data_sufficiency?: string | null
          error?: string | null
          generated_at?: string | null
          golden_description?: string | null
          golden_features?: Json
          golden_meta_description?: string | null
          golden_name?: string | null
          golden_seo_keywords?: Json | null
          golden_slug?: string | null
          hidden_images?: Json
          id?: string
          image_meta?: Json
          image_scores?: Json
          match_type?: Database["public"]["Enums"]["match_type"]
          matched_term?: string | null
          media_classification?: Json
          model?: string | null
          picked_urls?: string[]
          pinned_main_url?: string | null
          previous?: Json | null
          project_id?: string
          quality?: Json | null
          regenerated_main_image?: string | null
          rescrape_rounds?: number
          score_breakdown?: Json | null
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
      media_technical_settings: {
        Row: {
          apply_shadow: boolean
          component_a: string
          component_b: string | null
          custom_style_prompt: string | null
          main_image_rule: Database["public"]["Enums"]["main_image_rule"]
          max_gallery_images: number
          padding_percent: number
          project_id: string
          target_resolution: number
          updated_at: string
        }
        Insert: {
          apply_shadow?: boolean
          component_a?: string
          component_b?: string | null
          custom_style_prompt?: string | null
          main_image_rule?: Database["public"]["Enums"]["main_image_rule"]
          max_gallery_images?: number
          padding_percent?: number
          project_id: string
          target_resolution?: number
          updated_at?: string
        }
        Update: {
          apply_shadow?: boolean
          component_a?: string
          component_b?: string | null
          custom_style_prompt?: string | null
          main_image_rule?: Database["public"]["Enums"]["main_image_rule"]
          max_gallery_images?: number
          padding_percent?: number
          project_id?: string
          target_resolution?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_technical_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_products: {
        Row: {
          created_at: string
          description: string | null
          generated_lifestyle_prompt: string | null
          generated_thumb_prompt: string | null
          id: string
          last_error: string | null
          lifestyle_urls: Json
          name: string | null
          project_id: string
          prompt_source_hash: string | null
          source_image_url: string
          source_image_urls: string[]
          status: string
          thumbnail_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          generated_lifestyle_prompt?: string | null
          generated_thumb_prompt?: string | null
          id?: string
          last_error?: string | null
          lifestyle_urls?: Json
          name?: string | null
          project_id: string
          prompt_source_hash?: string | null
          source_image_url: string
          source_image_urls?: string[]
          status?: string
          thumbnail_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          generated_lifestyle_prompt?: string | null
          generated_thumb_prompt?: string | null
          id?: string
          last_error?: string | null
          lifestyle_urls?: Json
          name?: string | null
          project_id?: string
          prompt_source_hash?: string | null
          source_image_url?: string
          source_image_urls?: string[]
          status?: string
          thumbnail_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "photo_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_projects: {
        Row: {
          created_at: string
          id: string
          name: string
          requirements_pl: string | null
          style_prompt: string | null
          updated_at: string
          user_id: string
          variants_per_product: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          requirements_pl?: string | null
          style_prompt?: string | null
          updated_at?: string
          user_id: string
          variants_per_product?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          requirements_pl?: string | null
          style_prompt?: string | null
          updated_at?: string
          user_id?: string
          variants_per_product?: number
        }
        Relationships: []
      }
      product_sources: {
        Row: {
          cleaning_meta: Json | null
          created_at: string
          description: string | null
          extra_images: Json
          id: string
          image_meta: Json | null
          images: Json
          project_id: string
          raw: Json
          title: string | null
          url: string
        }
        Insert: {
          cleaning_meta?: Json | null
          created_at?: string
          description?: string | null
          extra_images?: Json
          id?: string
          image_meta?: Json | null
          images?: Json
          project_id: string
          raw?: Json
          title?: string | null
          url: string
        }
        Update: {
          cleaning_meta?: Json | null
          created_at?: string
          description?: string | null
          extra_images?: Json
          id?: string
          image_meta?: Json | null
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
      project_shares: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          password_hash: string
          password_updated_at: string
          project_id: string
          salt: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          password_hash: string
          password_updated_at?: string
          project_id: string
          salt: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          password_hash?: string
          password_updated_at?: string
          project_id?: string
          salt?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_shares_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
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
          settings: Json
          strategy: Database["public"]["Enums"]["mapping_strategy"]
          updated_at: string
          user_id: string
          visualization_requirements_pl: string | null
          visualization_style_prompt: string | null
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
          settings?: Json
          strategy?: Database["public"]["Enums"]["mapping_strategy"]
          updated_at?: string
          user_id: string
          visualization_requirements_pl?: string | null
          visualization_style_prompt?: string | null
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
          settings?: Json
          strategy?: Database["public"]["Enums"]["mapping_strategy"]
          updated_at?: string
          user_id?: string
          visualization_requirements_pl?: string | null
          visualization_style_prompt?: string | null
        }
        Relationships: []
      }
      search_results: {
        Row: {
          created_at: string
          id: string
          organic_urls: Json
          project_id: string
          query_variants: Json | null
          term: string
        }
        Insert: {
          created_at?: string
          id?: string
          organic_urls?: Json
          project_id: string
          query_variants?: Json | null
          term: string
        }
        Update: {
          created_at?: string
          id?: string
          organic_urls?: Json
          project_id?: string
          query_variants?: Json | null
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
          product_notes: string | null
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
          product_notes?: string | null
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
          product_notes?: string | null
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
      bulk_job_kind:
        | "GENERATE_GOLDEN"
        | "REGENERATE_MEDIA"
        | "FIRECRAWL_DISCOVERY"
        | "PHOTO_TOOL_GENERATE"
        | "PHOTO_TOOL_EDIT_IMAGE"
        | "PIM_VISUALIZATIONS"
        | "PIM_ALLEGRO_DESCRIPTION"
        | "PIM_RESCRAPE"
      bulk_job_status:
        | "PENDING"
        | "PROCESSING"
        | "COMPLETED"
        | "CANCELLED"
        | "FAILED"
      enrichment_status: "PENDING" | "MATCHED" | "GENERATED" | "FAILED"
      main_image_rule: "ONLY_A" | "A_AND_B_EXISTING" | "COMPOSITE_A_AND_B"
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
      bulk_job_kind: [
        "GENERATE_GOLDEN",
        "REGENERATE_MEDIA",
        "FIRECRAWL_DISCOVERY",
        "PHOTO_TOOL_GENERATE",
        "PHOTO_TOOL_EDIT_IMAGE",
        "PIM_VISUALIZATIONS",
        "PIM_ALLEGRO_DESCRIPTION",
        "PIM_RESCRAPE",
      ],
      bulk_job_status: [
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ],
      enrichment_status: ["PENDING", "MATCHED", "GENERATED", "FAILED"],
      main_image_rule: ["ONLY_A", "A_AND_B_EXISTING", "COMPOSITE_A_AND_B"],
      mapping_strategy: ["EAN", "NAZWA", "HYBRID"],
      match_type: ["EAN_MATCH", "NAME_MATCH", "HYBRID_MATCH", "NO_MATCH"],
    },
  },
} as const
