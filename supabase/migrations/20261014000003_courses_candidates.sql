-- =============================================================================
-- Adrenaline Rush: courses, public registration and candidate CRM
-- (roadmap phases 2 and 3). Safe to re-run.
-- =============================================================================

do $$ begin
  create type public.course_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.delivery_mode as enum ('online', 'in_person', 'hybrid', 'self_paced', 'customized');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.form_field_type as enum
    ('text', 'email', 'phone', 'number', 'select', 'multiselect', 'radio', 'checkbox', 'date', 'textarea', 'consent');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_status as enum ('open', 'done', 'cancelled');
exception when duplicate_object then null;
end $$;

-- Single-business helper: the organization public pages belong to.
create or replace function public.primary_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.organizations order by created_at limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Normalisation helpers (used for duplicate detection)
-- -----------------------------------------------------------------------------

create or replace function public.normalize_email(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(raw)), '');
$$;

-- Last 10 digits: matches "+91 98765 43210", "09876543210" and "9876543210".
create or replace function public.phone_match_key(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(right(regexp_replace(coalesce(raw, ''), '\D', '', 'g'), 10), '');
$$;

-- -----------------------------------------------------------------------------
-- Course catalogue
-- -----------------------------------------------------------------------------

create table if not exists public.course_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  slug             text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description      text check (description is null or char_length(description) <= 1000),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.courses (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  category_id           uuid references public.course_categories (id) on delete set null,
  title                 text not null check (char_length(btrim(title)) between 3 and 140),
  slug                  text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  short_description     text check (short_description is null or char_length(short_description) <= 300),
  description           text check (description is null or char_length(description) <= 20000),
  who_is_it_for         text check (who_is_it_for is null or char_length(who_is_it_for) <= 4000),
  cover_image_url       text check (cover_image_url is null or cover_image_url ~* '^https://'),
  instructor_name       text check (instructor_name is null or char_length(instructor_name) <= 120),
  level                 text check (level is null or char_length(level) <= 40),
  prerequisites         text check (prerequisites is null or char_length(prerequisites) <= 4000),
  learning_outcomes     text[] not null default '{}',
  duration_text         text check (duration_text is null or char_length(duration_text) <= 80),
  delivery_mode         public.delivery_mode not null default 'online',
  list_price            numeric(12, 2) check (list_price is null or list_price >= 0),
  discounted_price      numeric(12, 2) check (discounted_price is null or discounted_price >= 0),
  currency              char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  show_price            boolean not null default true,
  capacity              integer check (capacity is null or capacity > 0),
  status                public.course_status not null default 'draft',
  enrollment_opens_on   date,
  enrollment_closes_on  date,
  certificate_details   text check (certificate_details is null or char_length(certificate_details) <= 2000),
  faqs                  jsonb not null default '[]'::jsonb check (jsonb_typeof(faqs) = 'array'),
  demo_url              text check (demo_url is null or demo_url ~* '^https?://'),
  success_message       text check (success_message is null or char_length(success_message) <= 1000),
  published_at          timestamptz,
  created_by            uuid references public.user_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organization_id, slug),
  check (discounted_price is null or list_price is null or discounted_price <= list_price),
  check (enrollment_closes_on is null or enrollment_opens_on is null or enrollment_closes_on >= enrollment_opens_on)
);

create index if not exists courses_org_status_idx on public.courses (organization_id, status);
create index if not exists courses_category_idx on public.courses (category_id);

create table if not exists public.course_modules (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  description  text,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists course_modules_course_idx on public.course_modules (course_id, position);

create table if not exists public.lessons (
  id                uuid primary key default gen_random_uuid(),
  module_id         uuid not null references public.course_modules (id) on delete cascade,
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  duration_minutes  integer check (duration_minutes is null or duration_minutes > 0),
  position          integer not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists lessons_module_idx on public.lessons (module_id, position);

-- Registration form definition per course. Standard fields map to candidate
-- columns (maps_to); custom fields are stored in the registration's answers.
create table if not exists public.course_registration_fields (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (char_length(btrim(label)) between 1 and 200),
  type         public.form_field_type not null,
  maps_to      text check (maps_to is null or maps_to in (
                 'full_name', 'email', 'phone', 'city', 'country', 'company', 'job_title',
                 'total_experience_years', 'relevant_experience_years', 'skills', 'interests',
                 'learning_objectives', 'preferred_schedule', 'preferred_delivery_mode',
                 'employment_status', 'heard_about', 'marketing_consent', 'privacy_consent')),
  required     boolean not null default false,
  options      text[] not null default '{}',
  help_text    text check (help_text is null or char_length(help_text) <= 500),
  placeholder  text check (placeholder is null or char_length(placeholder) <= 200),
  position     integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (course_id, key)
);
create index if not exists course_registration_fields_course_idx on public.course_registration_fields (course_id, position);

-- -----------------------------------------------------------------------------
-- CRM
-- -----------------------------------------------------------------------------

create table if not exists public.lead_statuses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key              text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label            text not null check (char_length(btrim(label)) between 1 and 60),
  color            text not null default 'neutral' check (color in ('neutral', 'brand', 'success', 'warning', 'danger', 'violet', 'teal')),
  position         integer not null default 0,
  is_closed        boolean not null default false,
  is_won           boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (organization_id, key)
);

create table if not exists public.candidates (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null references public.organizations (id) on delete cascade,
  full_name                  text not null check (char_length(btrim(full_name)) between 1 and 160),
  email                      text check (email is null or char_length(email) <= 254),
  email_normalized           text generated always as (public.normalize_email(email)) stored,
  phone                      text check (phone is null or char_length(phone) <= 32),
  phone_key                  text generated always as (public.phone_match_key(phone)) stored,
  city                       text check (city is null or char_length(city) <= 100),
  country                    text check (country is null or char_length(country) <= 100),
  company                    text check (company is null or char_length(company) <= 160),
  job_title                  text check (job_title is null or char_length(job_title) <= 160),
  total_experience_years     numeric(4, 1) check (total_experience_years is null or total_experience_years between 0 and 60),
  relevant_experience_years  numeric(4, 1) check (relevant_experience_years is null or relevant_experience_years between 0 and 60),
  skills                     text check (skills is null or char_length(skills) <= 2000),
  interests                  text check (interests is null or char_length(interests) <= 2000),
  learning_objectives        text check (learning_objectives is null or char_length(learning_objectives) <= 4000),
  preferred_schedule         text check (preferred_schedule is null or char_length(preferred_schedule) <= 200),
  preferred_delivery_mode    text check (preferred_delivery_mode is null or char_length(preferred_delivery_mode) <= 60),
  employment_status          text check (employment_status is null or char_length(employment_status) <= 60),
  heard_about                text check (heard_about is null or char_length(heard_about) <= 200),
  lead_status_id             uuid references public.lead_statuses (id) on delete set null,
  owner_id                   uuid references public.user_profiles (id) on delete set null,
  source                     text check (source is null or char_length(source) <= 60),
  utm_source                 text check (utm_source is null or char_length(utm_source) <= 120),
  utm_medium                 text check (utm_medium is null or char_length(utm_medium) <= 120),
  utm_campaign               text check (utm_campaign is null or char_length(utm_campaign) <= 120),
  utm_content                text check (utm_content is null or char_length(utm_content) <= 120),
  referrer                   text check (referrer is null or char_length(referrer) <= 500),
  privacy_consent_at         timestamptz,
  marketing_consent          boolean not null default false,
  do_not_contact             boolean not null default false,
  last_contacted_at          timestamptz,
  is_archived                boolean not null default false,
  created_by                 uuid references public.user_profiles (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (email is not null or phone is not null)
);

create index if not exists candidates_org_created_idx on public.candidates (organization_id, created_at desc);
create index if not exists candidates_email_idx on public.candidates (organization_id, email_normalized);
create index if not exists candidates_phone_idx on public.candidates (organization_id, phone_key);
create index if not exists candidates_status_idx on public.candidates (organization_id, lead_status_id);
create index if not exists candidates_owner_idx on public.candidates (organization_id, owner_id);
create index if not exists candidates_search_idx on public.candidates
  using gin (to_tsvector('simple', coalesce(full_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(company, '')));

-- A candidate's interest in a course (from the public form, an import or staff).
create table if not exists public.course_registrations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  candidate_id      uuid not null references public.candidates (id) on delete cascade,
  course_id         uuid references public.courses (id) on delete set null,
  answers           jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  channel           text not null default 'public_form' check (channel in ('public_form', 'demo_request', 'import', 'manual')),
  utm_source        text, utm_medium text, utm_campaign text, utm_content text,
  referrer          text,
  duplicate_reason  text,
  created_at        timestamptz not null default now()
);
create index if not exists course_registrations_candidate_idx on public.course_registrations (candidate_id, created_at desc);
create index if not exists course_registrations_course_idx on public.course_registrations (course_id, created_at desc);
create index if not exists course_registrations_org_idx on public.course_registrations (organization_id, created_at desc);

create table if not exists public.candidate_notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  body             text not null check (char_length(btrim(body)) between 1 and 5000),
  author_id        uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists candidate_notes_candidate_idx on public.candidate_notes (candidate_id, created_at desc);

-- Timeline: registrations, status changes, notes, shares, payments, etc.
create table if not exists public.candidate_activities (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  type             text not null check (type ~ '^[a-z_]+$'),
  summary          text not null,
  details          jsonb not null default '{}'::jsonb,
  actor_id         uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists candidate_activities_candidate_idx on public.candidate_activities (candidate_id, created_at desc);
create index if not exists candidate_activities_org_idx on public.candidate_activities (organization_id, created_at desc);

create table if not exists public.follow_up_tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  notes            text check (notes is null or char_length(notes) <= 4000),
  due_at           timestamptz not null,
  assigned_to      uuid references public.user_profiles (id) on delete set null,
  status           public.task_status not null default 'open',
  completed_at     timestamptz,
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists follow_up_tasks_due_idx on public.follow_up_tasks (organization_id, status, due_at);
create index if not exists follow_up_tasks_candidate_idx on public.follow_up_tasks (candidate_id, due_at);

create table if not exists public.lead_status_history (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  from_status_id   uuid references public.lead_statuses (id) on delete set null,
  to_status_id     uuid references public.lead_statuses (id) on delete set null,
  changed_by       uuid references public.user_profiles (id) on delete set null,
  changed_at       timestamptz not null default now()
);
create index if not exists lead_status_history_candidate_idx on public.lead_status_history (candidate_id, changed_at desc);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

drop trigger if exists course_categories_updated_at on public.course_categories;
create trigger course_categories_updated_at before update on public.course_categories
  for each row execute function public.set_updated_at();
drop trigger if exists courses_updated_at on public.courses;
create trigger courses_updated_at before update on public.courses
  for each row execute function public.set_updated_at();
drop trigger if exists course_registration_fields_updated_at on public.course_registration_fields;
create trigger course_registration_fields_updated_at before update on public.course_registration_fields
  for each row execute function public.set_updated_at();
drop trigger if exists candidates_updated_at on public.candidates;
create trigger candidates_updated_at before update on public.candidates
  for each row execute function public.set_updated_at();
drop trigger if exists follow_up_tasks_updated_at on public.follow_up_tasks;
create trigger follow_up_tasks_updated_at before update on public.follow_up_tasks
  for each row execute function public.set_updated_at();

-- Stamp published_at the first time a course is published.
create or replace function public.courses_publish_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists courses_publish_stamp on public.courses;
create trigger courses_publish_stamp before insert or update on public.courses
  for each row execute function public.courses_publish_stamp();

-- Default registration fields for every new course.
create or replace function public.seed_course_registration_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.course_registration_fields (course_id, key, label, type, maps_to, required, options, position, placeholder, help_text)
  values
    (new.id, 'full_name', 'Full name', 'text', 'full_name', true, '{}', 10, null, null),
    (new.id, 'email', 'Email address', 'email', 'email', true, '{}', 20, 'you@example.com', null),
    (new.id, 'phone', 'Phone (with country code)', 'phone', 'phone', true, '{}', 30, '+91 98765 43210', null),
    (new.id, 'city', 'City', 'text', 'city', false, '{}', 40, null, null),
    (new.id, 'country', 'Country', 'text', 'country', false, '{}', 50, null, null),
    (new.id, 'company', 'Current company', 'text', 'company', false, '{}', 60, null, null),
    (new.id, 'job_title', 'Current job title', 'text', 'job_title', false, '{}', 70, null, null),
    (new.id, 'total_experience_years', 'Total experience (years)', 'number', 'total_experience_years', false, '{}', 80, null, null),
    (new.id, 'relevant_experience_years', 'Relevant experience (years)', 'number', 'relevant_experience_years', false, '{}', 90, null, null),
    (new.id, 'skills', 'Current skills', 'textarea', 'skills', false, '{}', 100, null, null),
    (new.id, 'learning_objectives', 'What do you want to achieve?', 'textarea', 'learning_objectives', false, '{}', 110, null, null),
    (new.id, 'preferred_schedule', 'Preferred schedule', 'select', 'preferred_schedule', false, array['Weekdays', 'Weekends', 'Evenings', 'Flexible'], 120, null, null),
    (new.id, 'employment_status', 'Employment status', 'select', 'employment_status', false, array['Employed', 'Student', 'Looking for work', 'Freelancer', 'Other'], 130, null, null),
    (new.id, 'heard_about', 'How did you hear about us?', 'select', 'heard_about', false, array['LinkedIn', 'WhatsApp', 'Telegram', 'Friend or colleague', 'Search', 'Other'], 140, null, null),
    (new.id, 'marketing_consent', 'I agree to receive course updates by email, phone or WhatsApp', 'checkbox', 'marketing_consent', false, '{}', 900, null, 'You can opt out at any time.'),
    (new.id, 'privacy_consent', 'I agree to the privacy policy', 'consent', 'privacy_consent', true, '{}', 910, null, null)
  on conflict (course_id, key) do nothing;
  return new;
end;
$$;
drop trigger if exists courses_seed_fields on public.courses;
create trigger courses_seed_fields after insert on public.courses
  for each row execute function public.seed_course_registration_fields();

-- Default lead statuses for every organization (and backfill existing ones).
create or replace function public.seed_lead_statuses(org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lead_statuses (organization_id, key, label, color, position, is_closed, is_won) values
    (org, 'new', 'New', 'brand', 10, false, false),
    (org, 'contacted', 'Contacted', 'teal', 20, false, false),
    (org, 'interested', 'Interested', 'teal', 30, false, false),
    (org, 'demo_requested', 'Demo Requested', 'violet', 40, false, false),
    (org, 'demo_shared', 'Demo Shared', 'violet', 50, false, false),
    (org, 'demo_attended', 'Demo Attended', 'violet', 60, false, false),
    (org, 'follow_up', 'Follow-up Required', 'warning', 70, false, false),
    (org, 'qualified', 'Qualified', 'brand', 80, false, false),
    (org, 'enrollment_offered', 'Enrollment Offered', 'warning', 90, false, false),
    (org, 'enrolled', 'Enrolled', 'success', 100, true, true),
    (org, 'not_interested', 'Not Interested', 'neutral', 110, true, false),
    (org, 'nurture', 'Nurture', 'neutral', 120, false, false),
    (org, 'lost', 'Closed / Lost', 'danger', 130, true, false)
  on conflict (organization_id, key) do nothing;
$$;

create or replace function public.organizations_seed_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_lead_statuses(new.id);
  return new;
end;
$$;
drop trigger if exists organizations_seed_defaults on public.organizations;
create trigger organizations_seed_defaults after insert on public.organizations
  for each row execute function public.organizations_seed_defaults();

select public.seed_lead_statuses(id) from public.organizations;

-- New candidates start as "New"; status changes are recorded with who/when.
create or replace function public.candidates_status_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.lead_status_id is null then
    select id into new.lead_status_id from public.lead_statuses
     where organization_id = new.organization_id and key = 'new';
  end if;
  if new.lead_status_id is not null and not exists (
    select 1 from public.lead_statuses where id = new.lead_status_id and organization_id = new.organization_id
  ) then
    raise exception 'Lead status belongs to another organization' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists candidates_status_defaults on public.candidates;
create trigger candidates_status_defaults before insert or update of lead_status_id on public.candidates
  for each row execute function public.candidates_status_defaults();

create or replace function public.candidates_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  from_label text;
  to_label text;
begin
  if tg_op = 'UPDATE' and new.lead_status_id is not distinct from old.lead_status_id then
    return new;
  end if;
  insert into public.lead_status_history (organization_id, candidate_id, from_status_id, to_status_id, changed_by)
  values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.lead_status_id end, new.lead_status_id, auth.uid());
  if tg_op = 'UPDATE' then
    select label into from_label from public.lead_statuses where id = old.lead_status_id;
    select label into to_label from public.lead_statuses where id = new.lead_status_id;
    insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
    values (new.organization_id, new.id, 'status_changed',
            format('Status changed from %s to %s', coalesce(from_label, '—'), coalesce(to_label, '—')),
            jsonb_build_object('from', old.lead_status_id, 'to', new.lead_status_id), auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists candidates_status_history on public.candidates;
create trigger candidates_status_history after insert or update of lead_status_id on public.candidates
  for each row execute function public.candidates_status_history();

-- Notes and tasks also land on the timeline.
create or replace function public.candidate_notes_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
  values (new.organization_id, new.candidate_id, 'note_added', 'Note added', jsonb_build_object('note_id', new.id), new.author_id);
  return new;
end;
$$;
drop trigger if exists candidate_notes_activity on public.candidate_notes;
create trigger candidate_notes_activity after insert on public.candidate_notes
  for each row execute function public.candidate_notes_activity();

create or replace function public.follow_up_tasks_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
    values (new.organization_id, new.candidate_id, 'follow_up_created', 'Follow-up scheduled: ' || new.title,
            jsonb_build_object('task_id', new.id, 'due_at', new.due_at), auth.uid());
  elsif new.status = 'done' and old.status <> 'done' then
    new.completed_at := coalesce(new.completed_at, now());
    insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
    values (new.organization_id, new.candidate_id, 'follow_up_done', 'Follow-up completed: ' || new.title,
            jsonb_build_object('task_id', new.id), auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists follow_up_tasks_activity_ins on public.follow_up_tasks;
create trigger follow_up_tasks_activity_ins after insert on public.follow_up_tasks
  for each row execute function public.follow_up_tasks_activity();
drop trigger if exists follow_up_tasks_activity_upd on public.follow_up_tasks;
create trigger follow_up_tasks_activity_upd before update of status on public.follow_up_tasks
  for each row execute function public.follow_up_tasks_activity();

-- Keep course + its children in the same organization.
create or replace function public.courses_check_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.course_categories where id = new.category_id and organization_id = new.organization_id
  ) then
    raise exception 'Category belongs to another organization' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists courses_check_category on public.courses;
create trigger courses_check_category before insert or update of category_id, organization_id on public.courses
  for each row execute function public.courses_check_category();

-- -----------------------------------------------------------------------------
-- Authorization helpers
-- -----------------------------------------------------------------------------

create or replace function public.can_view_candidate(org uuid, candidate_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(org, 'candidates.view_all')
      or (public.has_permission(org, 'candidates.view_assigned') and candidate_owner = (select auth.uid()));
$$;

create or replace function public.can_view_candidate_id(cand uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.candidates c
    where c.id = cand and public.can_view_candidate(c.organization_id, c.owner_id)
  );
$$;

create or replace function public.course_org(cid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.courses where id = cid;
$$;

-- -----------------------------------------------------------------------------
-- Public read API (sanitised; anon never reads tables directly)
-- -----------------------------------------------------------------------------

create or replace function public.course_is_open(c public.courses)
returns boolean
language sql
stable
set search_path = ''
as $$
  select c.status = 'published'
     and (c.enrollment_opens_on is null or c.enrollment_opens_on <= current_date)
     and (c.enrollment_closes_on is null or c.enrollment_closes_on >= current_date);
$$;

create or replace function public.public_course_json(c public.courses)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'slug', c.slug,
    'title', c.title,
    'short_description', c.short_description,
    'description', c.description,
    'who_is_it_for', c.who_is_it_for,
    'cover_image_url', c.cover_image_url,
    'instructor_name', c.instructor_name,
    'level', c.level,
    'prerequisites', c.prerequisites,
    'learning_outcomes', to_jsonb(c.learning_outcomes),
    'duration_text', c.duration_text,
    'delivery_mode', c.delivery_mode,
    'list_price', case when c.show_price then c.list_price end,
    'discounted_price', case when c.show_price then c.discounted_price end,
    'currency', c.currency,
    'show_price', c.show_price,
    'certificate_details', c.certificate_details,
    'faqs', c.faqs,
    'demo_url', c.demo_url,
    'success_message', c.success_message,
    'registration_open', public.course_is_open(c),
    'enrollment_closes_on', c.enrollment_closes_on,
    'category', (select jsonb_build_object('name', cc.name, 'slug', cc.slug) from public.course_categories cc where cc.id = c.category_id),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', m.title, 'description', m.description,
        'lessons', coalesce((select jsonb_agg(jsonb_build_object('title', l.title, 'duration_minutes', l.duration_minutes) order by l.position)
                             from public.lessons l where l.module_id = m.id), '[]'::jsonb)
      ) order by m.position)
      from public.course_modules m where m.course_id = c.id), '[]'::jsonb)
  );
$$;

create or replace function public.get_public_courses()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', c.slug, 'title', c.title, 'short_description', c.short_description,
      'cover_image_url', c.cover_image_url, 'level', c.level, 'duration_text', c.duration_text,
      'delivery_mode', c.delivery_mode, 'currency', c.currency, 'show_price', c.show_price,
      'list_price', case when c.show_price then c.list_price end,
      'discounted_price', case when c.show_price then c.discounted_price end,
      'registration_open', public.course_is_open(c),
      'category', (select jsonb_build_object('name', cc.name, 'slug', cc.slug) from public.course_categories cc where cc.id = c.category_id)
    ) order by c.published_at desc nulls last), '[]'::jsonb)
  from public.courses c
  where c.organization_id = public.primary_organization_id() and c.status = 'published';
$$;

create or replace function public.get_public_course(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.public_course_json(c)
  from public.courses c
  where c.organization_id = public.primary_organization_id() and c.slug = p_slug and c.status = 'published';
$$;

create or replace function public.get_public_registration_form(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'course', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'registration_open', public.course_is_open(c), 'success_message', c.success_message),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', f.key, 'label', f.label, 'type', f.type, 'required', f.required,
        'options', to_jsonb(f.options), 'help_text', f.help_text, 'placeholder', f.placeholder
      ) order by f.position, f.created_at)
      from public.course_registration_fields f where f.course_id = c.id and f.is_active), '[]'::jsonb)
  )
  from public.courses c
  where c.organization_id = public.primary_organization_id() and c.slug = p_slug and c.status = 'published';
$$;

-- -----------------------------------------------------------------------------
-- Public registration (called by the server with the secret key after
-- validation and rate limiting; never directly by browsers)
-- -----------------------------------------------------------------------------

create or replace function public.submit_registration(
  p_course_slug text,
  p_values jsonb,
  p_answers jsonb,
  p_attribution jsonb default '{}'::jsonb,
  p_channel text default 'public_form'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := public.primary_organization_id();
  crs public.courses;
  cand_id uuid;
  phone_match uuid;
  email_norm text := public.normalize_email(p_values ->> 'email');
  phone_k text := public.phone_match_key(p_values ->> 'phone');
  dup_reason text;
  reg_id uuid;
  is_new boolean := false;
  num_total numeric;
  num_relevant numeric;
begin
  select * into crs from public.courses
   where organization_id = org and slug = p_course_slug and status = 'published';
  if crs.id is null then
    raise exception 'Course not found' using errcode = 'P0002';
  end if;
  if p_channel = 'public_form' and not public.course_is_open(crs) then
    raise exception 'Registration is closed for this course' using errcode = '55000';
  end if;
  if coalesce(btrim(p_values ->> 'full_name'), '') = '' or (email_norm is null and phone_k is null) then
    raise exception 'Name and email or phone are required' using errcode = '22023';
  end if;

  num_total := nullif(p_values ->> 'total_experience_years', '')::numeric;
  num_relevant := nullif(p_values ->> 'relevant_experience_years', '')::numeric;

  -- Serialise registrations with the same email/phone to avoid racing duplicates.
  perform pg_advisory_xact_lock(hashtext(coalesce(email_norm, '') || '|' || coalesce(phone_k, '')));

  if email_norm is not null then
    select id into cand_id from public.candidates
     where organization_id = org and email_normalized = email_norm order by created_at limit 1;
  end if;
  if phone_k is not null then
    select id into phone_match from public.candidates
     where organization_id = org and phone_key = phone_k order by created_at limit 1;
  end if;

  if cand_id is not null then
    dup_reason := 'Matched an existing candidate by email; existing details were not overwritten.';
    if phone_match is not null and phone_match <> cand_id then
      dup_reason := dup_reason || ' The phone number also matches a different candidate.';
    end if;
  elsif phone_match is not null then
    cand_id := phone_match;
    dup_reason := 'Matched an existing candidate by phone; existing details were not overwritten.';
  else
    insert into public.candidates (
      organization_id, full_name, email, phone, city, country, company, job_title,
      total_experience_years, relevant_experience_years, skills, interests, learning_objectives,
      preferred_schedule, preferred_delivery_mode, employment_status, heard_about,
      source, utm_source, utm_medium, utm_campaign, utm_content, referrer,
      privacy_consent_at, marketing_consent
    ) values (
      org, btrim(p_values ->> 'full_name'), nullif(btrim(p_values ->> 'email'), ''), nullif(btrim(p_values ->> 'phone'), ''),
      nullif(p_values ->> 'city', ''), nullif(p_values ->> 'country', ''), nullif(p_values ->> 'company', ''), nullif(p_values ->> 'job_title', ''),
      num_total, num_relevant, nullif(p_values ->> 'skills', ''), nullif(p_values ->> 'interests', ''), nullif(p_values ->> 'learning_objectives', ''),
      nullif(p_values ->> 'preferred_schedule', ''), nullif(p_values ->> 'preferred_delivery_mode', ''), nullif(p_values ->> 'employment_status', ''), nullif(p_values ->> 'heard_about', ''),
      coalesce(nullif(p_attribution ->> 'source', ''), case p_channel when 'demo_request' then 'demo_request' else 'website' end),
      nullif(p_attribution ->> 'utm_source', ''), nullif(p_attribution ->> 'utm_medium', ''), nullif(p_attribution ->> 'utm_campaign', ''), nullif(p_attribution ->> 'utm_content', ''),
      nullif(p_attribution ->> 'referrer', ''),
      case when (p_values ->> 'privacy_consent')::boolean then now() end,
      coalesce((p_values ->> 'marketing_consent')::boolean, false)
    ) returning id into cand_id;
    is_new := true;
  end if;

  insert into public.course_registrations (organization_id, candidate_id, course_id, answers, channel,
    utm_source, utm_medium, utm_campaign, utm_content, referrer, duplicate_reason)
  values (org, cand_id, crs.id, coalesce(p_answers, '{}'::jsonb), p_channel,
    nullif(p_attribution ->> 'utm_source', ''), nullif(p_attribution ->> 'utm_medium', ''),
    nullif(p_attribution ->> 'utm_campaign', ''), nullif(p_attribution ->> 'utm_content', ''),
    nullif(p_attribution ->> 'referrer', ''), dup_reason)
  returning id into reg_id;

  insert into public.candidate_activities (organization_id, candidate_id, type, summary, details)
  values (org, cand_id,
          case p_channel when 'demo_request' then 'demo_requested' else 'registered' end,
          case p_channel when 'demo_request' then 'Requested a demo for ' else 'Registered for ' end || crs.title,
          jsonb_build_object('course_id', crs.id, 'registration_id', reg_id, 'duplicate', dup_reason is not null,
                             'utm_source', p_attribution ->> 'utm_source', 'utm_campaign', p_attribution ->> 'utm_campaign'));

  -- A returning candidate who opted in again keeps their consent fresh; we never downgrade it.
  if not is_new and (p_values ->> 'marketing_consent')::boolean then
    update public.candidates set marketing_consent = true where id = cand_id and not do_not_contact;
  end if;

  return jsonb_build_object('candidate_id', cand_id, 'registration_id', reg_id, 'is_new', is_new,
                            'duplicate', dup_reason is not null, 'success_message', crs.success_message,
                            'course_title', crs.title);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.course_categories          enable row level security;
alter table public.courses                    enable row level security;
alter table public.course_modules             enable row level security;
alter table public.lessons                    enable row level security;
alter table public.course_registration_fields enable row level security;
alter table public.lead_statuses              enable row level security;
alter table public.candidates                 enable row level security;
alter table public.course_registrations       enable row level security;
alter table public.candidate_notes            enable row level security;
alter table public.candidate_activities       enable row level security;
alter table public.follow_up_tasks            enable row level security;
alter table public.lead_status_history        enable row level security;

-- Catalogue: readable by anyone with courses.view, writable with courses.manage.
drop policy if exists "course viewers read categories" on public.course_categories;
create policy "course viewers read categories" on public.course_categories for select to authenticated
  using (public.has_permission(organization_id, 'courses.view'));
drop policy if exists "course managers write categories" on public.course_categories;
create policy "course managers write categories" on public.course_categories for all to authenticated
  using (public.has_permission(organization_id, 'courses.manage'))
  with check (public.has_permission(organization_id, 'courses.manage'));

drop policy if exists "course viewers read courses" on public.courses;
create policy "course viewers read courses" on public.courses for select to authenticated
  using (public.has_permission(organization_id, 'courses.view'));
drop policy if exists "course managers write courses" on public.courses;
create policy "course managers write courses" on public.courses for all to authenticated
  using (public.has_permission(organization_id, 'courses.manage'))
  with check (public.has_permission(organization_id, 'courses.manage'));

drop policy if exists "course viewers read modules" on public.course_modules;
create policy "course viewers read modules" on public.course_modules for select to authenticated
  using (public.has_permission(public.course_org(course_id), 'courses.view'));
drop policy if exists "course managers write modules" on public.course_modules;
create policy "course managers write modules" on public.course_modules for all to authenticated
  using (public.has_permission(public.course_org(course_id), 'courses.manage'))
  with check (public.has_permission(public.course_org(course_id), 'courses.manage'));

drop policy if exists "course viewers read lessons" on public.lessons;
create policy "course viewers read lessons" on public.lessons for select to authenticated
  using (exists (select 1 from public.course_modules m where m.id = module_id and public.has_permission(public.course_org(m.course_id), 'courses.view')));
drop policy if exists "course managers write lessons" on public.lessons;
create policy "course managers write lessons" on public.lessons for all to authenticated
  using (exists (select 1 from public.course_modules m where m.id = module_id and public.has_permission(public.course_org(m.course_id), 'courses.manage')))
  with check (exists (select 1 from public.course_modules m where m.id = module_id and public.has_permission(public.course_org(m.course_id), 'courses.manage')));

drop policy if exists "course viewers read form fields" on public.course_registration_fields;
create policy "course viewers read form fields" on public.course_registration_fields for select to authenticated
  using (public.has_permission(public.course_org(course_id), 'courses.view'));
drop policy if exists "course managers write form fields" on public.course_registration_fields;
create policy "course managers write form fields" on public.course_registration_fields for all to authenticated
  using (public.has_permission(public.course_org(course_id), 'courses.manage'))
  with check (public.has_permission(public.course_org(course_id), 'courses.manage'));

-- Lead statuses: any member reads; settings managers change.
drop policy if exists "members read lead statuses" on public.lead_statuses;
create policy "members read lead statuses" on public.lead_statuses for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists "settings managers write lead statuses" on public.lead_statuses;
create policy "settings managers write lead statuses" on public.lead_statuses for all to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'settings.manage'));

-- Candidates: all, or only assigned ones.
drop policy if exists "candidate viewers read candidates" on public.candidates;
create policy "candidate viewers read candidates" on public.candidates for select to authenticated
  using (public.can_view_candidate(organization_id, owner_id));
drop policy if exists "candidate managers add candidates" on public.candidates;
create policy "candidate managers add candidates" on public.candidates for insert to authenticated
  with check (public.has_permission(organization_id, 'candidates.manage')
              and (public.has_permission(organization_id, 'candidates.view_all') or owner_id = (select auth.uid())));
drop policy if exists "candidate managers update candidates" on public.candidates;
create policy "candidate managers update candidates" on public.candidates for update to authenticated
  using (public.has_permission(organization_id, 'candidates.manage') and public.can_view_candidate(organization_id, owner_id))
  with check (public.has_permission(organization_id, 'candidates.manage')
              and (public.has_permission(organization_id, 'candidates.view_all') or owner_id = (select auth.uid())));
drop policy if exists "full managers delete candidates" on public.candidates;
create policy "full managers delete candidates" on public.candidates for delete to authenticated
  using (public.has_permission(organization_id, 'candidates.view_all') and public.has_permission(organization_id, 'candidates.manage'));

-- Child records follow the candidate's visibility.
drop policy if exists "read registrations of visible candidates" on public.course_registrations;
create policy "read registrations of visible candidates" on public.course_registrations for select to authenticated
  using (public.can_view_candidate_id(candidate_id));
drop policy if exists "managers add registrations" on public.course_registrations;
create policy "managers add registrations" on public.course_registrations for insert to authenticated
  with check (public.has_permission(organization_id, 'candidates.manage') and public.can_view_candidate_id(candidate_id));

drop policy if exists "read notes of visible candidates" on public.candidate_notes;
create policy "read notes of visible candidates" on public.candidate_notes for select to authenticated
  using (public.can_view_candidate_id(candidate_id));
drop policy if exists "managers add notes" on public.candidate_notes;
create policy "managers add notes" on public.candidate_notes for insert to authenticated
  with check (public.has_permission(organization_id, 'candidates.manage') and public.can_view_candidate_id(candidate_id)
              and author_id = (select auth.uid()));

drop policy if exists "read activities of visible candidates" on public.candidate_activities;
create policy "read activities of visible candidates" on public.candidate_activities for select to authenticated
  using (public.can_view_candidate_id(candidate_id));
drop policy if exists "managers log activities" on public.candidate_activities;
create policy "managers log activities" on public.candidate_activities for insert to authenticated
  with check (public.can_view_candidate_id(candidate_id) and actor_id = (select auth.uid())
              and (public.has_permission(organization_id, 'candidates.manage') or public.has_permission(organization_id, 'resources.share')));

drop policy if exists "read tasks of visible candidates" on public.follow_up_tasks;
create policy "read tasks of visible candidates" on public.follow_up_tasks for select to authenticated
  using (public.can_view_candidate_id(candidate_id));
drop policy if exists "managers write tasks" on public.follow_up_tasks;
create policy "managers write tasks" on public.follow_up_tasks for all to authenticated
  using (public.has_permission(organization_id, 'candidates.manage') and public.can_view_candidate_id(candidate_id))
  with check (public.has_permission(organization_id, 'candidates.manage') and public.can_view_candidate_id(candidate_id));

drop policy if exists "read status history of visible candidates" on public.lead_status_history;
create policy "read status history of visible candidates" on public.lead_status_history for select to authenticated
  using (public.can_view_candidate_id(candidate_id));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

revoke all on public.course_categories, public.courses, public.course_modules, public.lessons,
  public.course_registration_fields, public.lead_statuses, public.candidates, public.course_registrations,
  public.candidate_notes, public.candidate_activities, public.follow_up_tasks, public.lead_status_history
  from anon, authenticated;

grant select, insert, update, delete on public.course_categories, public.courses, public.course_modules,
  public.lessons, public.course_registration_fields, public.lead_statuses, public.candidates,
  public.follow_up_tasks to authenticated;
grant select, insert on public.course_registrations, public.candidate_notes, public.candidate_activities to authenticated;
grant select on public.lead_status_history to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.health_check() to anon, authenticated;
grant execute on function public.setup_required() to anon, authenticated;
grant execute on function public.get_public_courses() to anon, authenticated;
grant execute on function public.get_public_course(text) to anon, authenticated;
grant execute on function public.get_public_registration_form(text) to anon, authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.current_membership(uuid) to authenticated;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.write_audit_log(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.is_valid_timezone(text) to authenticated;
grant execute on function public.can_view_candidate(uuid, uuid) to authenticated;
grant execute on function public.can_view_candidate_id(uuid) to authenticated;
grant execute on function public.course_org(uuid) to authenticated;
grant execute on function public.normalize_email(text) to authenticated;
grant execute on function public.phone_match_key(text) to authenticated;
grant execute on function public.course_is_open(public.courses) to authenticated;
grant execute on all functions in schema public to service_role;
