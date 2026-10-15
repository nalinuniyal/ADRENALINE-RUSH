-- =============================================================================
-- Adrenaline Rush: email notifications and automations
--   * email_settings     per-organization team recipients and reply-to
--   * email_templates    editable branded emails (structured design or custom HTML)
--   * email_automations  "when a registration arrives, send template X to Y"
--   * email_log          every send attempt with an honest status (append-only)
--   * media_assets       uploaded images (served publicly by /media/<id>)
-- Sending happens in the app (providers are configured with environment
-- variables); the database stores content, rules and the log. Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Every address in the list looks like an email address, and there are at most 20.
create or replace function public.email_list_is_valid(arr text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(arr), 0) <= 20
     and not exists (
       select 1 from unnest(coalesce(arr, '{}'::text[])) a
        where a is null or char_length(a) > 254 or a !~* '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$'
     );
$$;

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------

create table if not exists public.email_settings (
  organization_id   uuid primary key references public.organizations (id) on delete cascade,
  -- Team members who receive "new booking" notifications ("admins" recipient).
  admin_recipients  text[] not null default '{}' check (public.email_list_is_valid(admin_recipients)),
  reply_to          text check (reply_to is null or (char_length(reply_to) <= 254 and reply_to ~* '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$')),
  sender_name       text check (sender_name is null or char_length(btrim(sender_name)) between 1 and 80),
  updated_at        timestamptz not null default now()
);

drop trigger if exists email_settings_updated_at on public.email_settings;
create trigger email_settings_updated_at before update on public.email_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Templates
-- -----------------------------------------------------------------------------

create table if not exists public.email_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Stable key for seeded templates; null for templates created in the app.
  key              text check (key is null or key ~ '^[a-z][a-z0-9_]{0,59}$'),
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  -- Who the template is written for; decides which variables are offered.
  audience         text not null default 'candidate' check (audience in ('candidate', 'team')),
  subject          text not null check (char_length(btrim(subject)) between 1 and 200),
  preheader        text check (preheader is null or char_length(preheader) <= 200),
  -- { header_image_url, header_image_asset_id, heading, body, button_label,
  --   button_url, footer_text, accent_color }
  design           jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 30000),
  custom_html      text check (custom_html is null or char_length(custom_html) <= 100000),
  use_custom_html  boolean not null default false,
  created_by       uuid references public.user_profiles (id) on delete set null,
  updated_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, key),
  check (not use_custom_html or coalesce(char_length(btrim(custom_html)), 0) > 0)
);
create index if not exists email_templates_org_idx on public.email_templates (organization_id, name);

drop trigger if exists email_templates_updated_at on public.email_templates;
create trigger email_templates_updated_at before update on public.email_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Automations
-- -----------------------------------------------------------------------------

create table if not exists public.email_automations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  trigger          text not null default 'registration_created' check (trigger in ('registration_created')),
  -- Filters. A null course means every course, including ones created later.
  course_id        uuid references public.courses (id) on delete cascade,
  channel          text not null default 'demo_request' check (channel in ('demo_request', 'public_form', 'any')),
  recipient        text not null check (recipient in ('candidate', 'admins', 'custom')),
  custom_emails    text[] not null default '{}' check (public.email_list_is_valid(custom_emails)),
  template_id      uuid not null references public.email_templates (id) on delete restrict,
  is_active        boolean not null default true,
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (recipient <> 'custom' or cardinality(custom_emails) > 0)
);
create index if not exists email_automations_org_idx on public.email_automations (organization_id, trigger, is_active);
create index if not exists email_automations_template_idx on public.email_automations (template_id);
create index if not exists email_automations_course_idx on public.email_automations (course_id);

drop trigger if exists email_automations_updated_at on public.email_automations;
create trigger email_automations_updated_at before update on public.email_automations
  for each row execute function public.set_updated_at();

-- Template and course must belong to the automation's organization.
create or replace function public.email_automations_check_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.email_templates t where t.id = new.template_id and t.organization_id = new.organization_id) then
    raise exception 'Template belongs to another organization' using errcode = '23503';
  end if;
  if new.course_id is not null and not exists (
    select 1 from public.courses c where c.id = new.course_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Course belongs to another organization' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists email_automations_check_refs on public.email_automations;
create trigger email_automations_check_refs before insert or update on public.email_automations
  for each row execute function public.email_automations_check_refs();

-- -----------------------------------------------------------------------------
-- Send log (append-only for app users; written by the server with the secret key)
-- -----------------------------------------------------------------------------

create table if not exists public.email_log (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  kind                 text not null default 'automation' check (kind in ('automation', 'test')),
  automation_id        uuid references public.email_automations (id) on delete set null,
  template_id          uuid references public.email_templates (id) on delete set null,
  -- Deleting a candidate removes their log rows (they hold their address).
  candidate_id         uuid references public.candidates (id) on delete cascade,
  registration_id      uuid references public.course_registrations (id) on delete cascade,
  to_address           text check (to_address is null or char_length(to_address) <= 254),
  subject              text not null default '' check (char_length(subject) <= 300),
  status               text not null check (status in ('sent', 'failed', 'not_sent')),
  provider             text check (provider is null or provider in ('smtp', 'resend')),
  provider_message_id  text check (provider_message_id is null or char_length(provider_message_id) <= 300),
  error                text check (error is null or char_length(error) <= 1000),
  created_by           uuid references public.user_profiles (id) on delete set null,
  created_at           timestamptz not null default now()
);
create index if not exists email_log_org_created_idx on public.email_log (organization_id, created_at desc);
create index if not exists email_log_candidate_idx on public.email_log (candidate_id);
create index if not exists email_log_automation_idx on public.email_log (automation_id);
-- One successful send per automation, registration and address.
create unique index if not exists email_log_sent_once_idx
  on public.email_log (automation_id, registration_id, lower(to_address))
  where status = 'sent' and automation_id is not null and registration_id is not null and to_address is not null;

-- -----------------------------------------------------------------------------
-- Media (images for emails and pages). Stored in Postgres so no storage bucket
-- is needed; served by the app at /media/<id> with long cache headers.
-- -----------------------------------------------------------------------------

create table if not exists public.media_assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  file_name        text check (file_name is null or char_length(file_name) <= 200),
  content_type     text not null check (content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  data             bytea not null check (octet_length(data) between 1 and 2097152),
  byte_size        integer not null check (byte_size between 1 and 2097152),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width            integer check (width is null or width between 1 and 20000),
  height           integer check (height is null or height between 1 and 20000),
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (byte_size = octet_length(data))
);
create index if not exists media_assets_org_idx on public.media_assets (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Defaults for every organization: settings, two templates and two automations
-- (candidate confirmation + team notification for demo requests on all courses).
-- Seeded once, when the settings row is first created, so templates or
-- automations the owner deletes are not recreated by re-running setup.sql.
-- -----------------------------------------------------------------------------

create or replace function public.seed_email_defaults(org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  created uuid;
  t_candidate uuid;
  t_team uuid;
begin
  insert into public.email_settings (organization_id, admin_recipients)
  values (
    org,
    coalesce(array(
      select distinct lower(p.email)
        from public.organization_memberships m
        join public.user_profiles p on p.id = m.user_id
       where m.organization_id = org and m.role = 'owner' and m.status = 'active'
         and p.email ~* '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$'
       limit 20), '{}')
  )
  on conflict (organization_id) do nothing
  returning organization_id into created;

  if created is null then
    return;
  end if;

  insert into public.email_templates (organization_id, key, name, audience, subject, preheader, design)
  values (
    org, 'demo_confirmation_candidate', 'Demo booking confirmation (to candidate)', 'candidate',
    'You''re booked: {{course_title}} demo class',
    'Thanks {{first_name}}, here is what happens next.',
    jsonb_build_object(
      'heading', 'Your demo class is booked, {{first_name}}!',
      'body', $body$Thank you for booking a free demo class for {{course_title}} with {{business_name}}.

Our team will contact you shortly by email or phone with the date, time and joining link for your demo.

What you can expect from the course:
• Live classes with real-life, hands-on practice
• Interview practice and one-to-one discussions
• Support after the course for your development work

Have a question before the demo? Just reply to this email.$body$,
      'button_label', 'View course details',
      'button_url', '{{course_url}}',
      'footer_text', 'You are receiving this email because you booked a demo class on the {{business_name}} website.',
      'accent_color', '#0176d3'
    )
  )
  on conflict (organization_id, key) do nothing;

  insert into public.email_templates (organization_id, key, name, audience, subject, preheader, design)
  values (
    org, 'demo_booking_team', 'New demo booking (to admin)', 'team',
    'New demo booking: {{candidate_name}} for {{course_title}}',
    '{{candidate_name}} booked a demo class.',
    jsonb_build_object(
      'heading', 'New demo booking',
      'body', $body${{candidate_name}} has booked a demo class for {{course_title}}.

Email: {{candidate_email}}
Phone: {{candidate_phone}}

{{registration_answers}}$body$,
      'button_label', 'Open candidate',
      'button_url', '{{candidate_admin_url}}',
      'footer_text', 'Automatic notification from {{business_name}}. Change who receives it in Marketing → Emails → Settings.',
      'accent_color', '#032d60'
    )
  )
  on conflict (organization_id, key) do nothing;

  select id into t_candidate from public.email_templates where organization_id = org and key = 'demo_confirmation_candidate';
  select id into t_team from public.email_templates where organization_id = org and key = 'demo_booking_team';

  insert into public.email_automations (organization_id, name, trigger, course_id, channel, recipient, template_id, is_active)
  values
    (org, 'Confirm demo booking to the candidate', 'registration_created', null, 'demo_request', 'candidate', t_candidate, true),
    (org, 'Notify the team about a new demo booking', 'registration_created', null, 'demo_request', 'admins', t_team, true);
end;
$$;

create or replace function public.organizations_seed_email_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_email_defaults(new.id);
  return new;
end;
$$;
drop trigger if exists organizations_seed_email_defaults on public.organizations;
create trigger organizations_seed_email_defaults after insert on public.organizations
  for each row execute function public.organizations_seed_email_defaults();

-- The organization is created before its owner membership (bootstrap), so the
-- owner's address is added as the default team recipient when the owner joins.
create or replace function public.email_settings_default_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  addr text;
begin
  if new.role = 'owner' and new.status = 'active' then
    select lower(p.email) into addr from public.user_profiles p where p.id = new.user_id;
    if addr ~* '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$' then
      update public.email_settings
         set admin_recipients = array[addr]
       where organization_id = new.organization_id and cardinality(admin_recipients) = 0;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists email_settings_default_recipient on public.organization_memberships;
create trigger email_settings_default_recipient after insert on public.organization_memberships
  for each row execute function public.email_settings_default_recipient();

select public.seed_email_defaults(id) from public.organizations;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.email_settings    enable row level security;
alter table public.email_templates   enable row level security;
alter table public.email_automations enable row level security;
alter table public.email_log         enable row level security;
alter table public.media_assets      enable row level security;

drop policy if exists "marketing viewers read email settings" on public.email_settings;
create policy "marketing viewers read email settings" on public.email_settings for select to authenticated
  using (public.has_permission(organization_id, 'marketing.view'));
drop policy if exists "marketing managers update email settings" on public.email_settings;
create policy "marketing managers update email settings" on public.email_settings for update to authenticated
  using (public.has_permission(organization_id, 'marketing.manage'))
  with check (public.has_permission(organization_id, 'marketing.manage'));

drop policy if exists "marketing viewers read email templates" on public.email_templates;
create policy "marketing viewers read email templates" on public.email_templates for select to authenticated
  using (public.has_permission(organization_id, 'marketing.view'));
drop policy if exists "marketing managers write email templates" on public.email_templates;
create policy "marketing managers write email templates" on public.email_templates for all to authenticated
  using (public.has_permission(organization_id, 'marketing.manage'))
  with check (public.has_permission(organization_id, 'marketing.manage'));

drop policy if exists "marketing viewers read email automations" on public.email_automations;
create policy "marketing viewers read email automations" on public.email_automations for select to authenticated
  using (public.has_permission(organization_id, 'marketing.view'));
drop policy if exists "marketing managers write email automations" on public.email_automations;
create policy "marketing managers write email automations" on public.email_automations for all to authenticated
  using (public.has_permission(organization_id, 'marketing.manage'))
  with check (public.has_permission(organization_id, 'marketing.manage'));

-- The log holds addresses: rows about a candidate are visible only to people
-- who may see that candidate.
drop policy if exists "marketing viewers read email log" on public.email_log;
create policy "marketing viewers read email log" on public.email_log for select to authenticated
  using (public.has_permission(organization_id, 'marketing.view')
         and (candidate_id is null or public.can_view_candidate_id(candidate_id)));

-- Media metadata is readable by marketing and course viewers; the image bytes
-- are not granted to API roles at all (served by /media/<id>).
drop policy if exists "media viewers read media metadata" on public.media_assets;
create policy "media viewers read media metadata" on public.media_assets for select to authenticated
  using (public.has_permission(organization_id, 'marketing.view') or public.has_permission(organization_id, 'courses.view'));
drop policy if exists "media managers upload media" on public.media_assets;
create policy "media managers upload media" on public.media_assets for insert to authenticated
  with check ((public.has_permission(organization_id, 'marketing.manage') or public.has_permission(organization_id, 'courses.manage'))
              and created_by = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Table grants (Supabase's defaults grant everything to anon/authenticated)
-- -----------------------------------------------------------------------------

revoke all on public.email_settings, public.email_templates, public.email_automations,
  public.email_log, public.media_assets
  from anon, authenticated;

grant select on public.email_settings to authenticated;
grant update (admin_recipients, reply_to, sender_name) on public.email_settings to authenticated;
grant select, insert, update, delete on public.email_templates, public.email_automations to authenticated;
grant select on public.email_log to authenticated;
grant select (id, organization_id, file_name, content_type, byte_size, sha256, width, height, created_by, created_at)
  on public.media_assets to authenticated;
grant insert (id, organization_id, file_name, content_type, data, byte_size, sha256, width, height, created_by)
  on public.media_assets to authenticated;

grant all on public.email_settings, public.email_templates, public.email_automations,
  public.email_log, public.media_assets to service_role;

-- -----------------------------------------------------------------------------
-- Function grants (re-stated in full: Supabase default privileges grant new
-- functions to anon and authenticated, so every migration revokes and re-grants)
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.health_check() to anon, authenticated;
grant execute on function public.setup_required() to anon, authenticated;
grant execute on function public.get_public_courses() to anon, authenticated;
grant execute on function public.get_public_course(text) to anon, authenticated;
grant execute on function public.get_public_registration_form(text) to anon, authenticated;
grant execute on function public.get_public_site() to anon, authenticated;
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
grant execute on function public.list_candidate_owners(uuid) to authenticated;
grant execute on function public.find_candidate_duplicates(uuid, text, text, uuid) to authenticated;
grant execute on function public.find_existing_candidate_keys(uuid, text[], text[]) to authenticated;
grant execute on function public.import_candidates(uuid, jsonb, uuid, text) to authenticated;
-- Used by CHECK constraints on rows that authenticated users write.
grant execute on function public.email_list_is_valid(text[]) to authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on all functions in schema public to service_role;
