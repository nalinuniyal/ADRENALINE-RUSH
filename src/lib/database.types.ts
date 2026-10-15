export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: NonNullable<Json>;
          entity_id: string | null;
          entity_type: string | null;
          id: number;
          organization_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          organization_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          organization_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_activities: {
        Row: {
          actor_id: string | null;
          candidate_id: string;
          created_at: string;
          details: NonNullable<Json>;
          id: number;
          organization_id: string;
          summary: string;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          candidate_id: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: never;
          organization_id: string;
          summary: string;
          type: string;
        };
        Update: {
          actor_id?: string | null;
          candidate_id?: string;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: never;
          organization_id?: string;
          summary?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_activities_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_activities_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_activities_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_notes: {
        Row: {
          author_id: string | null;
          body: string;
          candidate_id: string;
          created_at: string;
          id: string;
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          body: string;
          candidate_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          candidate_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_notes_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_notes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      candidates: {
        Row: {
          city: string | null;
          company: string | null;
          country: string | null;
          created_at: string;
          created_by: string | null;
          do_not_contact: boolean;
          email: string | null;
          email_normalized: string | null;
          employment_status: string | null;
          full_name: string;
          heard_about: string | null;
          id: string;
          interests: string | null;
          is_archived: boolean;
          job_title: string | null;
          last_activity_at: string | null;
          last_contacted_at: string | null;
          lead_status_id: string | null;
          learning_objectives: string | null;
          marketing_consent: boolean;
          organization_id: string;
          owner_id: string | null;
          phone: string | null;
          phone_key: string | null;
          preferred_delivery_mode: string | null;
          preferred_schedule: string | null;
          privacy_consent_at: string | null;
          referrer: string | null;
          relevant_experience_years: number | null;
          skills: string | null;
          source: string | null;
          total_experience_years: number | null;
          updated_at: string;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
        };
        ComputedFields: never;
        Insert: {
          city?: string | null;
          company?: string | null;
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          do_not_contact?: boolean;
          email?: string | null;
          email_normalized?: never;
          employment_status?: string | null;
          full_name: string;
          heard_about?: string | null;
          id?: string;
          interests?: string | null;
          is_archived?: boolean;
          job_title?: string | null;
          last_activity_at?: string | null;
          last_contacted_at?: string | null;
          lead_status_id?: string | null;
          learning_objectives?: string | null;
          marketing_consent?: boolean;
          organization_id: string;
          owner_id?: string | null;
          phone?: string | null;
          phone_key?: never;
          preferred_delivery_mode?: string | null;
          preferred_schedule?: string | null;
          privacy_consent_at?: string | null;
          referrer?: string | null;
          relevant_experience_years?: number | null;
          skills?: string | null;
          source?: string | null;
          total_experience_years?: number | null;
          updated_at?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Update: {
          city?: string | null;
          company?: string | null;
          country?: string | null;
          created_at?: string;
          created_by?: string | null;
          do_not_contact?: boolean;
          email?: string | null;
          email_normalized?: never;
          employment_status?: string | null;
          full_name?: string;
          heard_about?: string | null;
          id?: string;
          interests?: string | null;
          is_archived?: boolean;
          job_title?: string | null;
          last_activity_at?: string | null;
          last_contacted_at?: string | null;
          lead_status_id?: string | null;
          learning_objectives?: string | null;
          marketing_consent?: boolean;
          organization_id?: string;
          owner_id?: string | null;
          phone?: string | null;
          phone_key?: never;
          preferred_delivery_mode?: string | null;
          preferred_schedule?: string | null;
          privacy_consent_at?: string | null;
          referrer?: string | null;
          relevant_experience_years?: number | null;
          skills?: string | null;
          source?: string | null;
          total_experience_years?: number | null;
          updated_at?: string;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "candidates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidates_lead_status_id_fkey";
            columns: ["lead_status_id"];
            isOneToOne: false;
            referencedRelation: "lead_statuses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidates_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      course_categories: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
          position: number;
          slug: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          position?: number;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          position?: number;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_categories_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      course_modules: {
        Row: {
          course_id: string;
          created_at: string;
          description: string | null;
          id: string;
          position: number;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          position?: number;
          title: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          position?: number;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      course_registration_fields: {
        Row: {
          course_id: string;
          created_at: string;
          help_text: string | null;
          id: string;
          is_active: boolean;
          key: string;
          label: string;
          maps_to: string | null;
          options: string[];
          placeholder: string | null;
          position: number;
          required: boolean;
          type: Database["public"]["Enums"]["form_field_type"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          help_text?: string | null;
          id?: string;
          is_active?: boolean;
          key: string;
          label: string;
          maps_to?: string | null;
          options?: string[];
          placeholder?: string | null;
          position?: number;
          required?: boolean;
          type: Database["public"]["Enums"]["form_field_type"];
          updated_at?: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          help_text?: string | null;
          id?: string;
          is_active?: boolean;
          key?: string;
          label?: string;
          maps_to?: string | null;
          options?: string[];
          placeholder?: string | null;
          position?: number;
          required?: boolean;
          type?: Database["public"]["Enums"]["form_field_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_registration_fields_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      course_registrations: {
        Row: {
          answers: NonNullable<Json>;
          candidate_id: string;
          channel: string;
          course_id: string | null;
          created_at: string;
          duplicate_reason: string | null;
          id: string;
          organization_id: string;
          referrer: string | null;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
        };
        ComputedFields: never;
        Insert: {
          answers?: NonNullable<Json>;
          candidate_id: string;
          channel?: string;
          course_id?: string | null;
          created_at?: string;
          duplicate_reason?: string | null;
          id?: string;
          organization_id: string;
          referrer?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Update: {
          answers?: NonNullable<Json>;
          candidate_id?: string;
          channel?: string;
          course_id?: string | null;
          created_at?: string;
          duplicate_reason?: string | null;
          id?: string;
          organization_id?: string;
          referrer?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "course_registrations_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_registrations_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_registrations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          capacity: number | null;
          category_id: string | null;
          certificate_details: string | null;
          cover_image_url: string | null;
          created_at: string;
          created_by: string | null;
          cta_label: string | null;
          currency: string;
          delivery_mode: Database["public"]["Enums"]["delivery_mode"];
          demo_url: string | null;
          description: string | null;
          discounted_price: number | null;
          duration_text: string | null;
          enrollment_closes_on: string | null;
          enrollment_opens_on: string | null;
          faqs: NonNullable<Json>;
          highlight_badge: string | null;
          id: string;
          inclusions: NonNullable<Json>;
          instructor_name: string | null;
          learning_outcomes: string[];
          level: string | null;
          list_price: number | null;
          organization_id: string;
          prerequisites: string | null;
          published_at: string | null;
          registration_mode: string;
          short_description: string | null;
          show_price: boolean;
          slug: string;
          status: Database["public"]["Enums"]["course_status"];
          success_message: string | null;
          title: string;
          updated_at: string;
          who_is_it_for: string | null;
          course_is_open: boolean | null;
          public_course_json: Json | null;
        };
        ComputedFields: "course_is_open" | "public_course_json";
        Insert: {
          capacity?: number | null;
          category_id?: string | null;
          certificate_details?: string | null;
          cover_image_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          currency?: string;
          delivery_mode?: Database["public"]["Enums"]["delivery_mode"];
          demo_url?: string | null;
          description?: string | null;
          discounted_price?: number | null;
          duration_text?: string | null;
          enrollment_closes_on?: string | null;
          enrollment_opens_on?: string | null;
          faqs?: NonNullable<Json>;
          highlight_badge?: string | null;
          id?: string;
          inclusions?: NonNullable<Json>;
          instructor_name?: string | null;
          learning_outcomes?: string[];
          level?: string | null;
          list_price?: number | null;
          organization_id: string;
          prerequisites?: string | null;
          published_at?: string | null;
          registration_mode?: string;
          short_description?: string | null;
          show_price?: boolean;
          slug: string;
          status?: Database["public"]["Enums"]["course_status"];
          success_message?: string | null;
          title: string;
          updated_at?: string;
          who_is_it_for?: string | null;
        };
        Update: {
          capacity?: number | null;
          category_id?: string | null;
          certificate_details?: string | null;
          cover_image_url?: string | null;
          created_at?: string;
          created_by?: string | null;
          cta_label?: string | null;
          currency?: string;
          delivery_mode?: Database["public"]["Enums"]["delivery_mode"];
          demo_url?: string | null;
          description?: string | null;
          discounted_price?: number | null;
          duration_text?: string | null;
          enrollment_closes_on?: string | null;
          enrollment_opens_on?: string | null;
          faqs?: NonNullable<Json>;
          highlight_badge?: string | null;
          id?: string;
          inclusions?: NonNullable<Json>;
          instructor_name?: string | null;
          learning_outcomes?: string[];
          level?: string | null;
          list_price?: number | null;
          organization_id?: string;
          prerequisites?: string | null;
          published_at?: string | null;
          registration_mode?: string;
          short_description?: string | null;
          show_price?: boolean;
          slug?: string;
          status?: Database["public"]["Enums"]["course_status"];
          success_message?: string | null;
          title?: string;
          updated_at?: string;
          who_is_it_for?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "courses_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "course_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      email_automations: {
        Row: {
          channel: string;
          course_id: string | null;
          created_at: string;
          created_by: string | null;
          custom_emails: string[];
          id: string;
          is_active: boolean;
          name: string;
          organization_id: string;
          recipient: string;
          template_id: string;
          trigger: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel?: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_emails?: string[];
          id?: string;
          is_active?: boolean;
          name: string;
          organization_id: string;
          recipient: string;
          template_id: string;
          trigger?: string;
          updated_at?: string;
        };
        Update: {
          channel?: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_emails?: string[];
          id?: string;
          is_active?: boolean;
          name?: string;
          organization_id?: string;
          recipient?: string;
          template_id?: string;
          trigger?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_automations_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_automations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_automations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_automations_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "email_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      email_log: {
        Row: {
          automation_id: string | null;
          candidate_id: string | null;
          created_at: string;
          created_by: string | null;
          error: string | null;
          id: string;
          kind: string;
          organization_id: string;
          provider: string | null;
          provider_message_id: string | null;
          registration_id: string | null;
          status: string;
          subject: string;
          template_id: string | null;
          to_address: string | null;
        };
        ComputedFields: never;
        Insert: {
          automation_id?: string | null;
          candidate_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          id?: string;
          kind?: string;
          organization_id: string;
          provider?: string | null;
          provider_message_id?: string | null;
          registration_id?: string | null;
          status: string;
          subject?: string;
          template_id?: string | null;
          to_address?: string | null;
        };
        Update: {
          automation_id?: string | null;
          candidate_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          error?: string | null;
          id?: string;
          kind?: string;
          organization_id?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          registration_id?: string | null;
          status?: string;
          subject?: string;
          template_id?: string | null;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "email_log_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "email_automations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_log_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_log_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_log_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_log_registration_id_fkey";
            columns: ["registration_id"];
            isOneToOne: false;
            referencedRelation: "course_registrations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_log_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "email_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      email_settings: {
        Row: {
          admin_recipients: string[];
          organization_id: string;
          reply_to: string | null;
          sender_name: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          admin_recipients?: string[];
          organization_id: string;
          reply_to?: string | null;
          sender_name?: string | null;
          updated_at?: string;
        };
        Update: {
          admin_recipients?: string[];
          organization_id?: string;
          reply_to?: string | null;
          sender_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      email_templates: {
        Row: {
          audience: string;
          created_at: string;
          created_by: string | null;
          custom_html: string | null;
          design: NonNullable<Json>;
          id: string;
          key: string | null;
          name: string;
          organization_id: string;
          preheader: string | null;
          subject: string;
          updated_at: string;
          updated_by: string | null;
          use_custom_html: boolean;
        };
        ComputedFields: never;
        Insert: {
          audience?: string;
          created_at?: string;
          created_by?: string | null;
          custom_html?: string | null;
          design?: NonNullable<Json>;
          id?: string;
          key?: string | null;
          name: string;
          organization_id: string;
          preheader?: string | null;
          subject: string;
          updated_at?: string;
          updated_by?: string | null;
          use_custom_html?: boolean;
        };
        Update: {
          audience?: string;
          created_at?: string;
          created_by?: string | null;
          custom_html?: string | null;
          design?: NonNullable<Json>;
          id?: string;
          key?: string | null;
          name?: string;
          organization_id?: string;
          preheader?: string | null;
          subject?: string;
          updated_at?: string;
          updated_by?: string | null;
          use_custom_html?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "email_templates_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      follow_up_tasks: {
        Row: {
          assigned_to: string | null;
          candidate_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          due_at: string;
          id: string;
          notes: string | null;
          organization_id: string;
          status: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assigned_to?: string | null;
          candidate_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at: string;
          id?: string;
          notes?: string | null;
          organization_id: string;
          status?: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          candidate_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at?: string;
          id?: string;
          notes?: string | null;
          organization_id?: string;
          status?: Database["public"]["Enums"]["task_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follow_up_tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_tasks_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_tasks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_tasks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_status_history: {
        Row: {
          candidate_id: string;
          changed_at: string;
          changed_by: string | null;
          from_status_id: string | null;
          id: number;
          organization_id: string;
          to_status_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          candidate_id: string;
          changed_at?: string;
          changed_by?: string | null;
          from_status_id?: string | null;
          id?: never;
          organization_id: string;
          to_status_id?: string | null;
        };
        Update: {
          candidate_id?: string;
          changed_at?: string;
          changed_by?: string | null;
          from_status_id?: string | null;
          id?: never;
          organization_id?: string;
          to_status_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lead_status_history_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_status_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_status_history_from_status_id_fkey";
            columns: ["from_status_id"];
            isOneToOne: false;
            referencedRelation: "lead_statuses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_status_history_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_status_history_to_status_id_fkey";
            columns: ["to_status_id"];
            isOneToOne: false;
            referencedRelation: "lead_statuses";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_statuses: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          is_closed: boolean;
          is_won: boolean;
          key: string;
          label: string;
          organization_id: string;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          is_closed?: boolean;
          is_won?: boolean;
          key: string;
          label: string;
          organization_id: string;
          position?: number;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          is_closed?: boolean;
          is_won?: boolean;
          key?: string;
          label?: string;
          organization_id?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "lead_statuses_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      lessons: {
        Row: {
          created_at: string;
          duration_minutes: number | null;
          id: string;
          module_id: string;
          position: number;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          module_id: string;
          position?: number;
          title: string;
        };
        Update: {
          created_at?: string;
          duration_minutes?: number | null;
          id?: string;
          module_id?: string;
          position?: number;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_module_id_fkey";
            columns: ["module_id"];
            isOneToOne: false;
            referencedRelation: "course_modules";
            referencedColumns: ["id"];
          },
        ];
      };
      media_assets: {
        Row: {
          byte_size: number;
          content_type: string;
          created_at: string;
          created_by: string | null;
          data: string;
          file_name: string | null;
          height: number | null;
          id: string;
          organization_id: string;
          sha256: string;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          byte_size: number;
          content_type: string;
          created_at?: string;
          created_by?: string | null;
          data: string;
          file_name?: string | null;
          height?: number | null;
          id?: string;
          organization_id: string;
          sha256: string;
          width?: number | null;
        };
        Update: {
          byte_size?: number;
          content_type?: string;
          created_at?: string;
          created_by?: string | null;
          data?: string;
          file_name?: string | null;
          height?: number | null;
          id?: string;
          organization_id?: string;
          sha256?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "media_assets_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "media_assets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      membership_permission_overrides: {
        Row: {
          allowed: boolean;
          created_at: string;
          membership_id: string;
          permission_key: string;
        };
        ComputedFields: never;
        Insert: {
          allowed: boolean;
          created_at?: string;
          membership_id: string;
          permission_key: string;
        };
        Update: {
          allowed?: boolean;
          created_at?: string;
          membership_id?: string;
          permission_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "membership_permission_overrides_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "organization_memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membership_permission_overrides_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
        ];
      };
      organization_memberships: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["member_role"];
          status: Database["public"]["Enums"]["membership_status"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          contact_email: string | null;
          contact_phone: string | null;
          created_at: string;
          default_currency: string;
          id: string;
          instructors_enabled: boolean;
          logo_url: string | null;
          name: string;
          slug: string;
          staff_enabled: boolean;
          timezone: string;
          updated_at: string;
          website_url: string | null;
        };
        ComputedFields: never;
        Insert: {
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          default_currency?: string;
          id?: string;
          instructors_enabled?: boolean;
          logo_url?: string | null;
          name: string;
          slug: string;
          staff_enabled?: boolean;
          timezone?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          default_currency?: string;
          id?: string;
          instructors_enabled?: boolean;
          logo_url?: string | null;
          name?: string;
          slug?: string;
          staff_enabled?: boolean;
          timezone?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [];
      };
      permissions: {
        Row: {
          description: string;
          key: string;
        };
        ComputedFields: never;
        Insert: {
          description: string;
          key: string;
        };
        Update: {
          description?: string;
          key?: string;
        };
        Relationships: [];
      };
      rate_limit_buckets: {
        Row: {
          hits: number;
          key: string;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          hits: number;
          key: string;
          window_start: string;
        };
        Update: {
          hits?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          permission_key: string;
          role: Database["public"]["Enums"]["member_role"];
        };
        ComputedFields: never;
        Insert: {
          permission_key: string;
          role: Database["public"]["Enums"]["member_role"];
        };
        Update: {
          permission_key?: string;
          role?: Database["public"]["Enums"]["member_role"];
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
        ];
      };
      site_settings: {
        Row: {
          about_text: string | null;
          address: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          created_at: string;
          facebook_url: string | null;
          featured_course_id: string | null;
          footer_tagline: string | null;
          hero_badge: string | null;
          hero_subtitle: string | null;
          hero_title: string | null;
          instagram_url: string | null;
          linkedin_url: string | null;
          organization_id: string;
          show_course_catalog: boolean;
          updated_at: string;
          whatsapp_number: string | null;
          x_url: string | null;
          youtube_url: string | null;
        };
        ComputedFields: never;
        Insert: {
          about_text?: string | null;
          address?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          facebook_url?: string | null;
          featured_course_id?: string | null;
          footer_tagline?: string | null;
          hero_badge?: string | null;
          hero_subtitle?: string | null;
          hero_title?: string | null;
          instagram_url?: string | null;
          linkedin_url?: string | null;
          organization_id: string;
          show_course_catalog?: boolean;
          updated_at?: string;
          whatsapp_number?: string | null;
          x_url?: string | null;
          youtube_url?: string | null;
        };
        Update: {
          about_text?: string | null;
          address?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          facebook_url?: string | null;
          featured_course_id?: string | null;
          footer_tagline?: string | null;
          hero_badge?: string | null;
          hero_subtitle?: string | null;
          hero_title?: string | null;
          instagram_url?: string | null;
          linkedin_url?: string | null;
          organization_id?: string;
          show_course_catalog?: boolean;
          updated_at?: string;
          whatsapp_number?: string | null;
          x_url?: string | null;
          youtube_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "site_settings_featured_course_id_fkey";
            columns: ["featured_course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "site_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      bootstrap_organization: {
        Args: {
          p_currency?: string;
          p_full_name?: string;
          p_org_name: string;
          p_org_slug: string;
          p_timezone?: string;
          p_user_id: string;
        };
        Returns: string;
      };
      can_view_candidate: {
        Args: { candidate_owner: string; org: string };
        Returns: boolean;
      };
      can_view_candidate_id: { Args: { cand: string }; Returns: boolean };
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      course_is_open: {
        Args: {
          c: Omit<
            Database["public"]["Tables"]["courses"]["Row"],
            Database["public"]["Tables"]["courses"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      course_org: { Args: { cid: string }; Returns: string };
      current_membership: {
        Args: { org_id: string };
        Returns: {
          created_at: string;
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["member_role"];
          status: Database["public"]["Enums"]["membership_status"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "organization_memberships";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      email_list_is_valid: { Args: { arr: string[] }; Returns: boolean };
      find_candidate_duplicates: {
        Args: {
          p_email: string;
          p_exclude?: string;
          p_org: string;
          p_phone: string;
        };
        Returns: {
          can_view: boolean;
          candidate_id: string;
          full_name: string;
          matched_on: string;
        }[];
      };
      find_existing_candidate_keys: {
        Args: { p_emails: string[]; p_org: string; p_phone_keys: string[] };
        Returns: {
          key: string;
          kind: string;
        }[];
      };
      get_my_access: {
        Args: Record<PropertyKey, never>;
        Returns: {
          default_currency: string;
          membership_id: string;
          organization_id: string;
          organization_name: string;
          organization_slug: string;
          permissions: string[];
          role: Database["public"]["Enums"]["member_role"];
          timezone: string;
        }[];
      };
      get_public_course: { Args: { p_slug: string }; Returns: Json };
      get_public_courses: { Args: Record<PropertyKey, never>; Returns: Json };
      get_public_registration_form: { Args: { p_slug: string }; Returns: Json };
      get_public_site: { Args: Record<PropertyKey, never>; Returns: Json };
      has_permission: {
        Args: { org_id: string; permission: string };
        Returns: boolean;
      };
      health_check: { Args: Record<PropertyKey, never>; Returns: boolean };
      import_candidates: {
        Args: {
          p_file_name?: string;
          p_org: string;
          p_owner_id?: string;
          p_rows: Json;
        };
        Returns: Json;
      };
      is_org_member: { Args: { org_id: string }; Returns: boolean };
      is_valid_timezone: { Args: { tz: string }; Returns: boolean };
      list_candidate_owners: {
        Args: { p_org: string };
        Returns: {
          email: string;
          full_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        }[];
      };
      normalize_email: { Args: { raw: string }; Returns: string };
      phone_match_key: { Args: { raw: string }; Returns: string };
      primary_organization_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      public_course_json: {
        Args: {
          c: Omit<
            Database["public"]["Tables"]["courses"]["Row"],
            Database["public"]["Tables"]["courses"]["ComputedFields"]
          >;
        };
        Returns: Json;
      };
      seed_email_defaults: { Args: { org: string }; Returns: undefined };
      seed_lead_statuses: { Args: { org: string }; Returns: undefined };
      setup_required: { Args: Record<PropertyKey, never>; Returns: boolean };
      submit_registration: {
        Args: {
          p_answers: Json;
          p_attribution?: Json;
          p_channel?: string;
          p_course_slug: string;
          p_values: Json;
        };
        Returns: Json;
      };
      write_audit_log: {
        Args: {
          p_action: string;
          p_details?: Json;
          p_entity_id?: string;
          p_entity_type?: string;
          p_organization_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      course_status: "draft" | "published" | "archived";
      delivery_mode:
        "online" | "in_person" | "hybrid" | "self_paced" | "customized";
      form_field_type:
        | "text"
        | "email"
        | "phone"
        | "number"
        | "select"
        | "multiselect"
        | "radio"
        | "checkbox"
        | "date"
        | "textarea"
        | "consent";
      member_role: "owner" | "admin" | "staff" | "instructor";
      membership_status: "invited" | "active" | "suspended";
      task_status: "open" | "done" | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      course_status: ["draft", "published", "archived"],
      delivery_mode: [
        "online",
        "in_person",
        "hybrid",
        "self_paced",
        "customized",
      ],
      form_field_type: [
        "text",
        "email",
        "phone",
        "number",
        "select",
        "multiselect",
        "radio",
        "checkbox",
        "date",
        "textarea",
        "consent",
      ],
      member_role: ["owner", "admin", "staff", "instructor"],
      membership_status: ["invited", "active", "suspended"],
      task_status: ["open", "done", "cancelled"],
    },
  },
} as const;
