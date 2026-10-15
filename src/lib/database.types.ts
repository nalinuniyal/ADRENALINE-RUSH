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
      attendance_records: {
        Row: {
          candidate_id: string;
          enrollment_id: string | null;
          id: string;
          note: string | null;
          organization_id: string;
          recorded_at: string;
          recorded_by: string | null;
          session_id: string;
          status: Database["public"]["Enums"]["attendance_status"];
        };
        ComputedFields: never;
        Insert: {
          candidate_id: string;
          enrollment_id?: string | null;
          id?: string;
          note?: string | null;
          organization_id: string;
          recorded_at?: string;
          recorded_by?: string | null;
          session_id: string;
          status: Database["public"]["Enums"]["attendance_status"];
        };
        Update: {
          candidate_id?: string;
          enrollment_id?: string | null;
          id?: string;
          note?: string | null;
          organization_id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          session_id?: string;
          status?: Database["public"]["Enums"]["attendance_status"];
        };
        Relationships: [
          {
            foreignKeyName: "attendance_records_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_records_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: false;
            referencedRelation: "enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_records_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_records_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "class_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
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
      batches: {
        Row: {
          capacity: number | null;
          class_days: number[];
          code: string | null;
          course_id: string;
          created_at: string;
          created_by: string | null;
          default_meeting_url: string | null;
          delivery_mode: Database["public"]["Enums"]["delivery_mode"];
          end_date: string | null;
          end_time: string | null;
          id: string;
          instructor_id: string | null;
          name: string;
          notes: string | null;
          organization_id: string;
          schedule_note: string | null;
          start_date: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["batch_status"];
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          capacity?: number | null;
          class_days?: number[];
          code?: string | null;
          course_id: string;
          created_at?: string;
          created_by?: string | null;
          default_meeting_url?: string | null;
          delivery_mode?: Database["public"]["Enums"]["delivery_mode"];
          end_date?: string | null;
          end_time?: string | null;
          id?: string;
          instructor_id?: string | null;
          name: string;
          notes?: string | null;
          organization_id: string;
          schedule_note?: string | null;
          start_date?: string | null;
          start_time?: string | null;
          status?: Database["public"]["Enums"]["batch_status"];
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          capacity?: number | null;
          class_days?: number[];
          code?: string | null;
          course_id?: string;
          created_at?: string;
          created_by?: string | null;
          default_meeting_url?: string | null;
          delivery_mode?: Database["public"]["Enums"]["delivery_mode"];
          end_date?: string | null;
          end_time?: string | null;
          id?: string;
          instructor_id?: string | null;
          name?: string;
          notes?: string | null;
          organization_id?: string;
          schedule_note?: string | null;
          start_date?: string | null;
          start_time?: string | null;
          status?: Database["public"]["Enums"]["batch_status"];
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "batches_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "batches_instructor_id_fkey";
            columns: ["instructor_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "batches_organization_id_fkey";
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
      class_sessions: {
        Row: {
          batch_id: string | null;
          cancelled_at: string | null;
          course_id: string;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string;
          google_add_attendees: boolean;
          google_event_id: string | null;
          google_sync_error: string | null;
          google_sync_status: string;
          google_synced_at: string | null;
          id: string;
          instructor_id: string | null;
          kind: string;
          meeting_source: string | null;
          meeting_url: string | null;
          notes: string | null;
          organization_id: string;
          prep_notes: string | null;
          recording_url: string | null;
          starts_at: string;
          status: Database["public"]["Enums"]["session_status"];
          timezone: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          batch_id?: string | null;
          cancelled_at?: string | null;
          course_id: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at: string;
          google_add_attendees?: boolean;
          google_event_id?: string | null;
          google_sync_error?: string | null;
          google_sync_status?: string;
          google_synced_at?: string | null;
          id?: string;
          instructor_id?: string | null;
          kind?: string;
          meeting_source?: string | null;
          meeting_url?: string | null;
          notes?: string | null;
          organization_id: string;
          prep_notes?: string | null;
          recording_url?: string | null;
          starts_at: string;
          status?: Database["public"]["Enums"]["session_status"];
          timezone?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          batch_id?: string | null;
          cancelled_at?: string | null;
          course_id?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at?: string;
          google_add_attendees?: boolean;
          google_event_id?: string | null;
          google_sync_error?: string | null;
          google_sync_status?: string;
          google_synced_at?: string | null;
          id?: string;
          instructor_id?: string | null;
          kind?: string;
          meeting_source?: string | null;
          meeting_url?: string | null;
          notes?: string | null;
          organization_id?: string;
          prep_notes?: string | null;
          recording_url?: string | null;
          starts_at?: string;
          status?: Database["public"]["Enums"]["session_status"];
          timezone?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "class_sessions_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "class_sessions_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "class_sessions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "class_sessions_instructor_id_fkey";
            columns: ["instructor_id"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "class_sessions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
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
      custom_role_permissions: {
        Row: {
          permission_key: string;
          role_id: string;
        };
        ComputedFields: never;
        Insert: {
          permission_key: string;
          role_id: string;
        };
        Update: {
          permission_key?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "custom_role_permissions_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "custom_role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "custom_roles";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_roles: {
        Row: {
          base_role: Database["public"]["Enums"]["member_role"];
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          base_role: Database["public"]["Enums"]["member_role"];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          base_role?: Database["public"]["Enums"]["member_role"];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "custom_roles_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "custom_roles_organization_id_fkey";
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
      enrollments: {
        Row: {
          batch_id: string | null;
          candidate_id: string;
          course_id: string;
          created_at: string;
          created_by: string | null;
          enrolled_at: string;
          id: string;
          notes: string | null;
          organization_id: string;
          status: Database["public"]["Enums"]["enrollment_status"];
          status_changed_at: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          batch_id?: string | null;
          candidate_id: string;
          course_id: string;
          created_at?: string;
          created_by?: string | null;
          enrolled_at?: string;
          id?: string;
          notes?: string | null;
          organization_id: string;
          status?: Database["public"]["Enums"]["enrollment_status"];
          status_changed_at?: string;
          updated_at?: string;
        };
        Update: {
          batch_id?: string | null;
          candidate_id?: string;
          course_id?: string;
          created_at?: string;
          created_by?: string | null;
          enrolled_at?: string;
          id?: string;
          notes?: string | null;
          organization_id?: string;
          status?: Database["public"]["Enums"]["enrollment_status"];
          status_changed_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enrollments_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_categories: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          organization_id: string;
          position: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          organization_id: string;
          position?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          organization_id?: string;
          position?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_categories_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          amount: number;
          batch_id: string | null;
          category_id: string;
          course_id: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          description: string;
          id: string;
          method: Database["public"]["Enums"]["finance_payment_method"];
          notes: string | null;
          organization_id: string;
          receipt_url: string | null;
          reference: string | null;
          spent_on: string;
          status: string;
          updated_at: string;
          vendor: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          batch_id?: string | null;
          category_id: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description: string;
          id?: string;
          method?: Database["public"]["Enums"]["finance_payment_method"];
          notes?: string | null;
          organization_id: string;
          receipt_url?: string | null;
          reference?: string | null;
          spent_on: string;
          status?: string;
          updated_at?: string;
          vendor?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          batch_id?: string | null;
          category_id?: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          description?: string;
          id?: string;
          method?: Database["public"]["Enums"]["finance_payment_method"];
          notes?: string | null;
          organization_id?: string;
          receipt_url?: string | null;
          reference?: string | null;
          spent_on?: string;
          status?: string;
          updated_at?: string;
          vendor?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_installments: {
        Row: {
          amount: number;
          created_at: string;
          due_date: string;
          fee_plan_id: string;
          id: string;
          label: string | null;
          organization_id: string;
          seq: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          due_date: string;
          fee_plan_id: string;
          id?: string;
          label?: string | null;
          organization_id: string;
          seq: number;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          due_date?: string;
          fee_plan_id?: string;
          id?: string;
          label?: string | null;
          organization_id?: string;
          seq?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_installments_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plan_balances";
            referencedColumns: ["fee_plan_id"];
          },
          {
            foreignKeyName: "fee_installments_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_installments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_pay_links: {
        Row: {
          amount_mode: string;
          created_at: string;
          created_by: string | null;
          fee_plan_id: string;
          id: string;
          last_opened_at: string | null;
          open_count: number;
          organization_id: string;
          revoked_at: string | null;
          revoked_by: string | null;
          status: string;
          token_hash: string;
          token_nonce: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount_mode: string;
          created_at?: string;
          created_by?: string | null;
          fee_plan_id: string;
          id?: string;
          last_opened_at?: string | null;
          open_count?: number;
          organization_id: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          status?: string;
          token_hash: string;
          token_nonce: string;
          updated_at?: string;
        };
        Update: {
          amount_mode?: string;
          created_at?: string;
          created_by?: string | null;
          fee_plan_id?: string;
          id?: string;
          last_opened_at?: string | null;
          open_count?: number;
          organization_id?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          status?: string;
          token_hash?: string;
          token_nonce?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_pay_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_pay_links_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plan_balances";
            referencedColumns: ["fee_plan_id"];
          },
          {
            foreignKeyName: "fee_pay_links_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_pay_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_pay_links_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_plans: {
        Row: {
          base_fee: number;
          candidate_id: string;
          course_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          discount_amount: number;
          discount_reason: string | null;
          discount_type: string;
          discount_value: number;
          enrollment_id: string;
          final_fee: number;
          id: string;
          notes: string | null;
          organization_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          base_fee: number;
          candidate_id: string;
          course_id: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          discount_amount?: number;
          discount_reason?: string | null;
          discount_type?: string;
          discount_value?: number;
          enrollment_id: string;
          final_fee?: number;
          id?: string;
          notes?: string | null;
          organization_id: string;
          updated_at?: string;
        };
        Update: {
          base_fee?: number;
          candidate_id?: string;
          course_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          discount_amount?: number;
          discount_reason?: string | null;
          discount_type?: string;
          discount_value?: number;
          enrollment_id?: string;
          final_fee?: number;
          id?: string;
          notes?: string | null;
          organization_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_plans_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_plans_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_plans_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_plans_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: true;
            referencedRelation: "enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_plans_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
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
      google_integrations: {
        Row: {
          access_token_encrypted: string | null;
          access_token_expires_at: string | null;
          calendar_id: string;
          connected_at: string | null;
          connected_by: string | null;
          last_error: string | null;
          last_error_at: string | null;
          organization_id: string;
          refresh_token_encrypted: string | null;
          scopes: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          access_token_encrypted?: string | null;
          access_token_expires_at?: string | null;
          calendar_id?: string;
          connected_at?: string | null;
          connected_by?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
          organization_id: string;
          refresh_token_encrypted?: string | null;
          scopes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          access_token_encrypted?: string | null;
          access_token_expires_at?: string | null;
          calendar_id?: string;
          connected_at?: string | null;
          connected_by?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
          organization_id?: string;
          refresh_token_encrypted?: string | null;
          scopes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_integrations_connected_by_fkey";
            columns: ["connected_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "google_integrations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
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
          custom_role_id: string | null;
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
          custom_role_id?: string | null;
          id?: string;
          organization_id: string;
          role: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          custom_role_id?: string | null;
          id?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_custom_role_fk";
            columns: ["custom_role_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "custom_roles";
            referencedColumns: ["id", "organization_id"];
          },
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
      organization_role_permissions: {
        Row: {
          allowed: boolean;
          organization_id: string;
          permission_key: string;
          role: Database["public"]["Enums"]["member_role"];
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          allowed: boolean;
          organization_id: string;
          permission_key: string;
          role: Database["public"]["Enums"]["member_role"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          allowed?: boolean;
          organization_id?: string;
          permission_key?: string;
          role?: Database["public"]["Enums"]["member_role"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "organization_role_permissions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_role_permissions_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "organization_role_permissions_updated_by_fkey";
            columns: ["updated_by"];
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
      payment_links: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string | null;
          currency: string;
          error: string | null;
          fee_plan_id: string;
          id: string;
          installment_id: string | null;
          organization_id: string;
          paid_at: string | null;
          payment_id: string | null;
          provider: string;
          provider_link_id: string | null;
          short_url: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string | null;
          currency: string;
          error?: string | null;
          fee_plan_id: string;
          id?: string;
          installment_id?: string | null;
          organization_id: string;
          paid_at?: string | null;
          payment_id?: string | null;
          provider?: string;
          provider_link_id?: string | null;
          short_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          error?: string | null;
          fee_plan_id?: string;
          id?: string;
          installment_id?: string | null;
          organization_id?: string;
          paid_at?: string | null;
          payment_id?: string | null;
          provider?: string;
          provider_link_id?: string | null;
          short_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_links_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plan_balances";
            referencedColumns: ["fee_plan_id"];
          },
          {
            foreignKeyName: "payment_links_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_links_installment_id_fkey";
            columns: ["installment_id"];
            isOneToOne: false;
            referencedRelation: "fee_installments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_links_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_links_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_refunds: {
        Row: {
          amount: number;
          created_at: string;
          fee_plan_id: string;
          id: string;
          method: Database["public"]["Enums"]["finance_payment_method"];
          organization_id: string;
          payment_id: string;
          reason: string;
          recorded_by: string | null;
          reference: string | null;
          refunded_on: string;
          status: string;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          fee_plan_id: string;
          id?: string;
          method?: Database["public"]["Enums"]["finance_payment_method"];
          organization_id: string;
          payment_id: string;
          reason: string;
          recorded_by?: string | null;
          reference?: string | null;
          refunded_on: string;
          status?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          fee_plan_id?: string;
          id?: string;
          method?: Database["public"]["Enums"]["finance_payment_method"];
          organization_id?: string;
          payment_id?: string;
          reason?: string;
          recorded_by?: string | null;
          reference?: string | null;
          refunded_on?: string;
          status?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_refunds_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plan_balances";
            referencedColumns: ["fee_plan_id"];
          },
          {
            foreignKeyName: "payment_refunds_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_refunds_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_settings: {
        Row: {
          bank_account_holder: string | null;
          bank_account_last4: string | null;
          bank_account_number: string | null;
          bank_account_type: string | null;
          bank_branch: string | null;
          bank_ifsc: string | null;
          bank_name: string | null;
          confirm_email_body: string;
          confirm_email_enabled: boolean;
          confirm_email_subject: string;
          created_at: string;
          instructions: string | null;
          organization_id: string;
          show_in_reminders: boolean;
          show_on_course_pages: boolean;
          show_on_pay_page: boolean;
          updated_at: string;
          updated_by: string | null;
          upi_payee_name: string | null;
          upi_qr_media_id: string | null;
          upi_vpa: string | null;
        };
        ComputedFields: never;
        Insert: {
          bank_account_holder?: string | null;
          bank_account_last4?: never;
          bank_account_number?: string | null;
          bank_account_type?: string | null;
          bank_branch?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          confirm_email_body?: string;
          confirm_email_enabled?: boolean;
          confirm_email_subject?: string;
          created_at?: string;
          instructions?: string | null;
          organization_id: string;
          show_in_reminders?: boolean;
          show_on_course_pages?: boolean;
          show_on_pay_page?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          upi_payee_name?: string | null;
          upi_qr_media_id?: string | null;
          upi_vpa?: string | null;
        };
        Update: {
          bank_account_holder?: string | null;
          bank_account_last4?: never;
          bank_account_number?: string | null;
          bank_account_type?: string | null;
          bank_branch?: string | null;
          bank_ifsc?: string | null;
          bank_name?: string | null;
          confirm_email_body?: string;
          confirm_email_enabled?: boolean;
          confirm_email_subject?: string;
          created_at?: string;
          instructions?: string | null;
          organization_id?: string;
          show_in_reminders?: boolean;
          show_on_course_pages?: boolean;
          show_on_pay_page?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          upi_payee_name?: string | null;
          upi_qr_media_id?: string | null;
          upi_vpa?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_settings_upi_qr_media_id_fkey";
            columns: ["upi_qr_media_id"];
            isOneToOne: false;
            referencedRelation: "media_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_submissions: {
        Row: {
          amount: number;
          candidate_id: string;
          created_at: string;
          currency: string;
          fee_plan_id: string;
          has_screenshot: boolean | null;
          id: string;
          installment_id: string | null;
          method: string;
          note: string | null;
          organization_id: string;
          paid_on: string;
          pay_link_id: string;
          payment_id: string | null;
          reject_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          screenshot: string | null;
          screenshot_type: string | null;
          status: string;
          updated_at: string;
          utr: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          candidate_id: string;
          created_at?: string;
          currency: string;
          fee_plan_id: string;
          has_screenshot?: never;
          id?: string;
          installment_id?: string | null;
          method: string;
          note?: string | null;
          organization_id: string;
          paid_on: string;
          pay_link_id: string;
          payment_id?: string | null;
          reject_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          screenshot?: string | null;
          screenshot_type?: string | null;
          status?: string;
          updated_at?: string;
          utr: string;
        };
        Update: {
          amount?: number;
          candidate_id?: string;
          created_at?: string;
          currency?: string;
          fee_plan_id?: string;
          has_screenshot?: never;
          id?: string;
          installment_id?: string | null;
          method?: string;
          note?: string | null;
          organization_id?: string;
          paid_on?: string;
          pay_link_id?: string;
          payment_id?: string | null;
          reject_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          screenshot?: string | null;
          screenshot_type?: string | null;
          status?: string;
          updated_at?: string;
          utr?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_submissions_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_submissions_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plan_balances";
            referencedColumns: ["fee_plan_id"];
          },
          {
            foreignKeyName: "payment_submissions_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_submissions_installment_id_fkey";
            columns: ["installment_id"];
            isOneToOne: false;
            referencedRelation: "fee_installments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_submissions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_submissions_pay_link_id_fkey";
            columns: ["pay_link_id"];
            isOneToOne: false;
            referencedRelation: "fee_pay_links";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_submissions_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_submissions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          candidate_id: string;
          created_at: string;
          currency: string;
          enrollment_id: string;
          fee_plan_id: string;
          gateway: string | null;
          gateway_link_id: string | null;
          gateway_payment_id: string | null;
          id: string;
          installment_id: string | null;
          method: Database["public"]["Enums"]["finance_payment_method"];
          notes: string | null;
          organization_id: string;
          paid_on: string;
          receipt_number: string | null;
          recorded_by: string | null;
          reference: string | null;
          status: Database["public"]["Enums"]["finance_payment_status"];
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          candidate_id: string;
          created_at?: string;
          currency: string;
          enrollment_id: string;
          fee_plan_id: string;
          gateway?: string | null;
          gateway_link_id?: string | null;
          gateway_payment_id?: string | null;
          id?: string;
          installment_id?: string | null;
          method: Database["public"]["Enums"]["finance_payment_method"];
          notes?: string | null;
          organization_id: string;
          paid_on: string;
          receipt_number?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          status?: Database["public"]["Enums"]["finance_payment_status"];
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          candidate_id?: string;
          created_at?: string;
          currency?: string;
          enrollment_id?: string;
          fee_plan_id?: string;
          gateway?: string | null;
          gateway_link_id?: string | null;
          gateway_payment_id?: string | null;
          id?: string;
          installment_id?: string | null;
          method?: Database["public"]["Enums"]["finance_payment_method"];
          notes?: string | null;
          organization_id?: string;
          paid_on?: string;
          receipt_number?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          status?: Database["public"]["Enums"]["finance_payment_status"];
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: false;
            referencedRelation: "enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plan_balances";
            referencedColumns: ["fee_plan_id"];
          },
          {
            foreignKeyName: "payments_fee_plan_id_fkey";
            columns: ["fee_plan_id"];
            isOneToOne: false;
            referencedRelation: "fee_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_installment_id_fkey";
            columns: ["installment_id"];
            isOneToOne: false;
            referencedRelation: "fee_installments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
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
      receipt_counters: {
        Row: {
          last_number: number;
          organization_id: string;
          year: number;
        };
        ComputedFields: never;
        Insert: {
          last_number?: number;
          organization_id: string;
          year: number;
        };
        Update: {
          last_number?: number;
          organization_id?: string;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "receipt_counters_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_courses: {
        Row: {
          course_id: string;
          created_at: string;
          resource_id: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          created_at?: string;
          resource_id: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          resource_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_courses_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_courses_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_shares: {
        Row: {
          batch_id: string | null;
          candidate_id: string | null;
          created_at: string;
          error: string | null;
          id: string;
          message: string | null;
          method: string;
          organization_id: string;
          recipient: string | null;
          resource_ids: string[];
          resource_titles: string[];
          shared_by: string | null;
          status: string;
          template_id: string | null;
          template_name: string | null;
        };
        ComputedFields: never;
        Insert: {
          batch_id?: string | null;
          candidate_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          message?: string | null;
          method: string;
          organization_id: string;
          recipient?: string | null;
          resource_ids: string[];
          resource_titles?: string[];
          shared_by?: string | null;
          status: string;
          template_id?: string | null;
          template_name?: string | null;
        };
        Update: {
          batch_id?: string | null;
          candidate_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          message?: string | null;
          method?: string;
          organization_id?: string;
          recipient?: string | null;
          resource_ids?: string[];
          resource_titles?: string[];
          shared_by?: string | null;
          status?: string;
          template_id?: string | null;
          template_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "resource_shares_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_shares_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_shares_shared_by_fkey";
            columns: ["shared_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_shares_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "share_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      resources: {
        Row: {
          access_instructions: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          expires_on: string | null;
          id: string;
          is_active: boolean;
          organization_id: string;
          slug: string;
          thumbnail_url: string | null;
          title: string;
          type: string;
          updated_at: string;
          updated_by: string | null;
          url: string;
          visibility: string;
          resource_is_shareable: boolean | null;
        };
        ComputedFields: "resource_is_shareable";
        Insert: {
          access_instructions?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expires_on?: string | null;
          id?: string;
          is_active?: boolean;
          organization_id: string;
          slug: string;
          thumbnail_url?: string | null;
          title: string;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
          url: string;
          visibility?: string;
        };
        Update: {
          access_instructions?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          expires_on?: string | null;
          id?: string;
          is_active?: boolean;
          organization_id?: string;
          slug?: string;
          thumbnail_url?: string | null;
          title?: string;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
          url?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resources_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resources_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resources_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
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
      session_attendees: {
        Row: {
          added_by: string | null;
          candidate_id: string;
          created_at: string;
          organization_id: string;
          session_id: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          candidate_id: string;
          created_at?: string;
          organization_id: string;
          session_id: string;
        };
        Update: {
          added_by?: string | null;
          candidate_id?: string;
          created_at?: string;
          organization_id?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_attendees_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_attendees_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_attendees_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_attendees_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "class_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      share_templates: {
        Row: {
          body: string;
          channel: string;
          created_at: string;
          created_by: string | null;
          id: string;
          key: string | null;
          name: string;
          organization_id: string;
          position: number;
          subject: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          channel?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key?: string | null;
          name: string;
          organization_id: string;
          position?: number;
          subject?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          body?: string;
          channel?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key?: string | null;
          name?: string;
          organization_id?: string;
          position?: number;
          subject?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "share_templates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "share_templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "share_templates_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sharing_settings: {
        Row: {
          organization_id: string;
          updated_at: string;
          updated_by: string | null;
          whatsapp_country_code: string;
        };
        ComputedFields: never;
        Insert: {
          organization_id: string;
          updated_at?: string;
          updated_by?: string | null;
          whatsapp_country_code?: string;
        };
        Update: {
          organization_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          whatsapp_country_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sharing_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sharing_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
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
      team_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          custom_role_id: string | null;
          email: string;
          email_error: string | null;
          email_status: string | null;
          expires_at: string;
          full_name: string;
          id: string;
          invited_by: string | null;
          last_sent_at: string | null;
          membership_id: string | null;
          organization_id: string;
          phone: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          role: Database["public"]["Enums"]["member_role"];
          send_count: number;
          status: string;
          token_hash: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          custom_role_id?: string | null;
          email: string;
          email_error?: string | null;
          email_status?: string | null;
          expires_at: string;
          full_name: string;
          id?: string;
          invited_by?: string | null;
          last_sent_at?: string | null;
          membership_id?: string | null;
          organization_id: string;
          phone?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role: Database["public"]["Enums"]["member_role"];
          send_count?: number;
          status?: string;
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          custom_role_id?: string | null;
          email?: string;
          email_error?: string | null;
          email_status?: string | null;
          expires_at?: string;
          full_name?: string;
          id?: string;
          invited_by?: string | null;
          last_sent_at?: string | null;
          membership_id?: string | null;
          organization_id?: string;
          phone?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
          send_count?: number;
          status?: string;
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_invitations_accepted_by_fkey";
            columns: ["accepted_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_invitations_custom_role_id_fkey";
            columns: ["custom_role_id"];
            isOneToOne: false;
            referencedRelation: "custom_roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_invitations_membership_id_fkey";
            columns: ["membership_id"];
            isOneToOne: false;
            referencedRelation: "organization_memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_invitations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_invitations_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "user_profiles";
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
      fee_plan_balances: {
        Row: {
          candidate_id: string | null;
          course_id: string | null;
          credit: number | null;
          currency: string | null;
          enrollment_id: string | null;
          fee_plan_id: string | null;
          final_fee: number | null;
          gross_paid: number | null;
          net_paid: number | null;
          organization_id: string | null;
          outstanding: number | null;
          refunded: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "fee_plans_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_plans_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_plans_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: true;
            referencedRelation: "enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_plans_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      accept_team_invitation: {
        Args: { p_full_name?: string; p_token_hash: string; p_user_id: string };
        Returns: {
          membership_id: string;
          organization_id: string;
          result: string;
          role: Database["public"]["Enums"]["member_role"];
        }[];
      };
      analytics_activity_series: {
        Args: {
          p_bucket?: string;
          p_from: string;
          p_org: string;
          p_to: string;
        };
        Returns: {
          bucket: string;
          enrollments: number;
          leads: number;
          registrations: number;
        }[];
      };
      analytics_batch_attendance: {
        Args: { p_from: string; p_org: string; p_to: string };
        Returns: {
          absent: number;
          attendance_rate: number;
          batch_id: string;
          batch_name: string;
          course_title: string;
          excused: number;
          late: number;
          marked_sessions: number;
          present: number;
          sessions: number;
        }[];
      };
      analytics_check: {
        Args: {
          p_from: string;
          p_org: string;
          p_permission?: string;
          p_to: string;
        };
        Returns: undefined;
      };
      analytics_course_performance: {
        Args: { p_from: string; p_org: string; p_to: string };
        Returns: {
          collections: number;
          course_id: string;
          currency: string;
          demo_bookings: number;
          enrollments: number;
          outstanding: number;
          refunds: number;
          registrations: number;
          revenue: number;
          status: string;
          title: string;
        }[];
      };
      analytics_funnel: {
        Args: { p_from: string; p_org: string; p_to: string };
        Returns: {
          candidates: number;
          key: string;
          label: string;
          stage: number;
        }[];
      };
      analytics_kpis: {
        Args: { p_from: string; p_org: string; p_to: string };
        Returns: {
          active_students: number;
          demo_bookings: number;
          demo_enrolled: number;
          enrollments: number;
          new_leads: number;
          overdue_follow_ups: number;
          registrations: number;
        }[];
      };
      analytics_lead_sources: {
        Args: { p_from: string; p_org: string; p_to: string };
        Returns: {
          channel: string;
          demo_bookings: number;
          enrolled: number;
          leads: number;
          utm_campaign: string;
          utm_medium: string;
        }[];
      };
      analytics_money_series: {
        Args: { p_from: string; p_org: string; p_to: string };
        Returns: {
          cash_result: number;
          collections: number;
          expenses: number;
          month: string;
          net: number;
          refunds: number;
        }[];
      };
      analytics_status_rank: {
        Args: { p_is_won: boolean; p_key: string };
        Returns: number;
      };
      analytics_top_resources: {
        Args: { p_from: string; p_limit?: number; p_org: string; p_to: string };
        Returns: {
          candidates: number;
          resource_id: string;
          shares: number;
          title: string;
        }[];
      };
      analytics_tz: { Args: { p_org: string }; Returns: string };
      approve_payment_submission: {
        Args: { p_amount?: number; p_paid_on?: string; p_submission: string };
        Returns: Json;
      };
      assert_can_manage_roles: {
        Args: { base: Database["public"]["Enums"]["member_role"]; org: string };
        Returns: undefined;
      };
      assert_holds_permissions: {
        Args: { keys: string[]; org: string; what: string };
        Returns: undefined;
      };
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
      can_record_attendance: { Args: { sid: string }; Returns: boolean };
      can_view_batch: {
        Args: { batch_instructor: string; org: string };
        Returns: boolean;
      };
      can_view_batch_id: { Args: { bid: string }; Returns: boolean };
      can_view_candidate: {
        Args: { candidate_owner: string; org: string };
        Returns: boolean;
      };
      can_view_candidate_id: { Args: { cand: string }; Returns: boolean };
      can_view_session: {
        Args: {
          org: string;
          session_batch: string;
          session_instructor: string;
        };
        Returns: boolean;
      };
      can_view_session_id: { Args: { sid: string }; Returns: boolean };
      clean_permission_list: { Args: { keys: string[] }; Returns: string[] };
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
      create_custom_role: {
        Args: {
          p_base_role: Database["public"]["Enums"]["member_role"];
          p_description: string;
          p_name: string;
          p_org: string;
          p_permissions: string[];
        };
        Returns: string;
      };
      create_fee_pay_link: {
        Args: {
          p_id: string;
          p_mode: string;
          p_nonce: string;
          p_plan: string;
          p_token_hash: string;
        };
        Returns: string;
      };
      current_membership: {
        Args: { org_id: string };
        Returns: {
          created_at: string;
          custom_role_id: string | null;
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
      delete_custom_role: { Args: { p_role_id: string }; Returns: undefined };
      email_list_is_valid: { Args: { arr: string[] }; Returns: boolean };
      enrollment_fee_qualifies: {
        Args: { s: Database["public"]["Enums"]["enrollment_status"] };
        Returns: boolean;
      };
      enrollment_holds_seat: {
        Args: { s: Database["public"]["Enums"]["enrollment_status"] };
        Returns: boolean;
      };
      fee_pay_amount: {
        Args: { p_mode: string; p_plan: string };
        Returns: {
          amount: number;
          due_date: string;
          installment_id: string;
          label: string;
          outstanding: number;
        }[];
      };
      fee_plan_allocation: {
        Args: { p_plan: string };
        Returns: {
          installment_id: string;
          paid: number;
        }[];
      };
      fee_plan_reference: { Args: { p_plan: string }; Returns: string };
      fee_plan_schedule: {
        Args: { p_plan: string; p_today?: string };
        Returns: {
          amount: number;
          due_date: string;
          installment_id: string;
          label: string;
          paid: number;
          remaining: number;
          seq: number;
          status: string;
        }[];
      };
      finance_overdue_installments: {
        Args: {
          p_batch?: string;
          p_course?: string;
          p_org: string;
          p_today?: string;
        };
        Returns: {
          amount: number;
          batch_id: string;
          candidate_id: string;
          course_id: string;
          currency: string;
          days_overdue: number;
          due_date: string;
          enrollment_id: string;
          fee_plan_id: string;
          installment_id: string;
          label: string;
          remaining: number;
          seq: number;
        }[];
      };
      finance_summary: {
        Args: {
          p_batch?: string;
          p_course?: string;
          p_from?: string;
          p_org: string;
          p_to?: string;
        };
        Returns: {
          booked: number;
          cash_result: number;
          currency: string;
          expense_count: number;
          expenses: number;
          gross: number;
          net: number;
          other_currency_rows: number;
          outstanding: number;
          overdue: number;
          overdue_count: number;
          payment_count: number;
          refunds: number;
        }[];
      };
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
      get_batch_roster: {
        Args: { p_batch: string };
        Returns: {
          can_view_candidate: boolean;
          candidate_id: string;
          email: string;
          enrolled_at: string;
          enrollment_id: string;
          full_name: string;
          notes: string;
          phone: string;
          status: Database["public"]["Enums"]["enrollment_status"];
        }[];
      };
      get_fee_pay_page: { Args: { p_token_hash: string }; Returns: Json };
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
      get_my_access_v2: {
        Args: Record<PropertyKey, never>;
        Returns: {
          custom_role_id: string;
          custom_role_name: string;
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
      get_public_payment_details: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      get_public_registration_form: { Args: { p_slug: string }; Returns: Json };
      get_public_resource: { Args: { p_slug: string }; Returns: Json };
      get_public_site: { Args: Record<PropertyKey, never>; Returns: Json };
      get_session_people: {
        Args: { p_session: string };
        Returns: {
          attendance: Database["public"]["Enums"]["attendance_status"];
          candidate_id: string;
          email: string;
          enrollment_status: Database["public"]["Enums"]["enrollment_status"];
          full_name: string;
          note: string;
          recorded_at: string;
          recorded_by: string;
        }[];
      };
      get_team_invitation: {
        Args: { p_token_hash: string };
        Returns: {
          email: string;
          expires_at: string;
          full_name: string;
          invitation_id: string;
          organization_name: string;
          role: Database["public"]["Enums"]["member_role"];
          role_enabled: boolean;
          status: string;
        }[];
      };
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
      is_active_member: {
        Args: { org: string; uid: string };
        Returns: boolean;
      };
      is_org_member: { Args: { org_id: string }; Returns: boolean };
      is_org_owner: { Args: { org: string }; Returns: boolean };
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
      list_instructor_options: {
        Args: { p_org: string };
        Returns: {
          email: string;
          full_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        }[];
      };
      log_fee_reminder: {
        Args: {
          p_channel: string;
          p_installment?: string;
          p_plan: string;
          p_status: string;
        };
        Returns: undefined;
      };
      membership_permission: {
        Args: {
          m: Omit<
            Database["public"]["Tables"]["organization_memberships"]["Row"],
            Database["public"]["Tables"]["organization_memberships"]["ComputedFields"]
          >;
          permission: string;
        };
        Returns: boolean;
      };
      next_receipt_number: {
        Args: { org: string; yr: number };
        Returns: string;
      };
      normalize_email: { Args: { raw: string }; Returns: string };
      org_today: { Args: { org: string }; Returns: string };
      payment_settings_account_number: {
        Args: { p_org: string };
        Returns: string;
      };
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
      record_gateway_payment: {
        Args: {
          p_amount_paise: number;
          p_currency: string;
          p_gateway_payment_id: string;
          p_link_status?: string;
          p_paid_at: string;
          p_provider_link_id: string;
        };
        Returns: Json;
      };
      record_session_outcome: {
        Args: {
          p_completed: boolean;
          p_recording_url: string;
          p_session: string;
        };
        Returns: undefined;
      };
      refresh_batch_fullness: { Args: { bid: string }; Returns: undefined };
      reject_payment_submission: {
        Args: { p_reason: string; p_submission: string };
        Returns: undefined;
      };
      reset_builtin_role_permissions: {
        Args: {
          p_org: string;
          p_role: Database["public"]["Enums"]["member_role"];
        };
        Returns: undefined;
      };
      resource_is_shareable: {
        Args: {
          r: Omit<
            Database["public"]["Tables"]["resources"]["Row"],
            Database["public"]["Tables"]["resources"]["ComputedFields"]
          >;
        };
        Returns: boolean;
      };
      resource_org: { Args: { rid: string }; Returns: string };
      resource_share_counts: {
        Args: { p_org: string };
        Returns: {
          last_shared_at: string;
          resource_id: string;
          shares: number;
        }[];
      };
      role_grants: {
        Args: {
          custom_role: string;
          org: string;
          permission: string;
          r: Database["public"]["Enums"]["member_role"];
        };
        Returns: boolean;
      };
      role_permission_keys: {
        Args: {
          custom_role: string;
          org: string;
          r: Database["public"]["Enums"]["member_role"];
        };
        Returns: string[];
      };
      save_fee_plan: {
        Args: {
          p_base_fee: number;
          p_currency: string;
          p_discount_reason: string;
          p_discount_type: string;
          p_discount_value: number;
          p_enrollment: string;
          p_installments?: Json;
          p_notes: string;
        };
        Returns: string;
      };
      seed_email_defaults: { Args: { org: string }; Returns: undefined };
      seed_expense_categories: { Args: { org: string }; Returns: undefined };
      seed_lead_statuses: { Args: { org: string }; Returns: undefined };
      seed_sharing_defaults: { Args: { org: string }; Returns: undefined };
      seed_team_invitation_template: {
        Args: { org: string };
        Returns: undefined;
      };
      set_builtin_role_permissions: {
        Args: {
          p_org: string;
          p_permissions: string[];
          p_role: Database["public"]["Enums"]["member_role"];
        };
        Returns: undefined;
      };
      setup_required: { Args: Record<PropertyKey, never>; Returns: boolean };
      submit_fee_payment_proof: {
        Args: {
          p_amount: number;
          p_method: string;
          p_note?: string;
          p_paid_on: string;
          p_screenshot?: string;
          p_screenshot_type?: string;
          p_token_hash: string;
          p_utr: string;
        };
        Returns: Json;
      };
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
      update_custom_role: {
        Args: {
          p_description: string;
          p_name: string;
          p_permissions: string[];
          p_role_id: string;
        };
        Returns: undefined;
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
      attendance_status: "present" | "absent" | "late" | "excused";
      batch_status:
        "planned" | "open" | "full" | "running" | "completed" | "cancelled";
      course_status: "draft" | "published" | "archived";
      delivery_mode:
        "online" | "in_person" | "hybrid" | "self_paced" | "customized";
      enrollment_status:
        | "pending"
        | "active"
        | "on_hold"
        | "completed"
        | "dropped"
        | "cancelled";
      finance_payment_method:
        | "cash"
        | "upi"
        | "bank_transfer"
        | "card"
        | "cheque"
        | "razorpay"
        | "other";
      finance_payment_status: "pending" | "completed" | "failed" | "voided";
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
      session_status: "scheduled" | "completed" | "cancelled";
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
      attendance_status: ["present", "absent", "late", "excused"],
      batch_status: [
        "planned",
        "open",
        "full",
        "running",
        "completed",
        "cancelled",
      ],
      course_status: ["draft", "published", "archived"],
      delivery_mode: [
        "online",
        "in_person",
        "hybrid",
        "self_paced",
        "customized",
      ],
      enrollment_status: [
        "pending",
        "active",
        "on_hold",
        "completed",
        "dropped",
        "cancelled",
      ],
      finance_payment_method: [
        "cash",
        "upi",
        "bank_transfer",
        "card",
        "cheque",
        "razorpay",
        "other",
      ],
      finance_payment_status: ["pending", "completed", "failed", "voided"],
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
      session_status: ["scheduled", "completed", "cancelled"],
      task_status: ["open", "done", "cancelled"],
    },
  },
} as const;
