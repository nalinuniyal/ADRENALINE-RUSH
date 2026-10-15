-- =============================================================================
-- ADRENALINE RUSH: COMPLETE DATABASE SETUP
--
-- How to use:
--   1. Supabase dashboard -> SQL Editor -> New query
--   2. Paste this entire file and click "Run"
--   3. You should see "Success. No rows returned"
--
-- Safe to run again: after downloading a newer version of the app, run the
-- newer setup.sql the same way to apply the changes. Existing data is kept.
--
-- Generated from supabase/migrations by `npm run db:setup-sql`. Do not edit by hand.
-- Contains: 20261014000001_foundation.sql, 20261014000002_rate_limits.sql, 20261014000003_courses_candidates.sql, 20261014000004_crm_import.sql, 20261014000005_course_content.sql, 20261014000006_email.sql, 20261014000007_shorter_registration_form.sql
-- =============================================================================

-- >>>>>>>>>>>>>>>>>>>> 20261014000001_foundation.sql

-- =============================================================================
-- Adrenaline Rush: Phase 1 foundation
--   organizations, user profiles, memberships, roles & permissions, audit log,
--   first-owner bootstrap, and Row Level Security for all of it.
--
-- Conventions used in every later migration:
--   * UUID primary keys (gen_random_uuid()), created_at / updated_at timestamptz.
--   * Every table holding private business data has RLS enabled and policies
--     expressed through public.has_permission(org_id, permission_key).
--   * SECURITY DEFINER functions always pin search_path = '' and use
--     schema-qualified names.
--   * anon never gets direct table access to private tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.member_role as enum ('owner', 'admin', 'staff', 'instructor');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.membership_status as enum ('invited', 'active', 'suspended');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Organizations (one training business today; multi-tenant ready)
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 2 and 120),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  default_currency    char(3) not null default 'INR' check (default_currency ~ '^[A-Z]{3}$'),
  timezone            text not null default 'Asia/Kolkata',
  contact_email       text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone       text check (contact_phone is null or char_length(contact_phone) <= 32),
  website_url         text check (website_url is null or website_url ~* '^https?://'),
  logo_url            text check (logo_url is null or logo_url ~* '^https?://'),
  staff_enabled       boolean not null default false,
  instructors_enabled boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function public.organizations_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'Invalid time zone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_validate on public.organizations;
create trigger organizations_validate
  before insert or update on public.organizations
  for each row execute function public.organizations_validate();

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- User profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------

create table if not exists public.user_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text check (full_name is null or char_length(full_name) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists user_profiles_email_idx on public.user_profiles (lower(email));

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Keep a profile row for every auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Mirror email changes made through Supabase Auth.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_change();

-- -----------------------------------------------------------------------------
-- Memberships
-- -----------------------------------------------------------------------------

create table if not exists public.organization_memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.user_profiles (id) on delete cascade,
  role             public.member_role not null,
  status           public.membership_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists organization_memberships_user_idx on public.organization_memberships (user_id);

drop trigger if exists organization_memberships_updated_at on public.organization_memberships;
create trigger organization_memberships_updated_at
  before update on public.organization_memberships
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Permission catalog
-- -----------------------------------------------------------------------------

create table if not exists public.permissions (
  key          text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description  text not null
);

create table if not exists public.role_permissions (
  role            public.member_role not null,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role, permission_key)
);

-- Per-member grants/revocations on top of the role defaults.
create table if not exists public.membership_permission_overrides (
  membership_id   uuid not null references public.organization_memberships (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  allowed         boolean not null,
  created_at      timestamptz not null default now(),
  primary key (membership_id, permission_key)
);

insert into public.permissions (key, description) values
  ('dashboard.view',          'See the dashboard'),
  ('courses.view',            'View courses and categories'),
  ('courses.manage',          'Create, edit, publish and archive courses and categories'),
  ('candidates.view_all',     'View every candidate'),
  ('candidates.view_assigned','View candidates assigned to me'),
  ('candidates.manage',       'Update candidates, notes, statuses and follow-ups I can see'),
  ('candidates.import',       'Import candidates from CSV'),
  ('candidates.export',       'Export candidates to CSV'),
  ('resources.view',          'View demos and learning resources'),
  ('resources.manage',        'Create and edit demos and learning resources'),
  ('resources.share',         'Share demos and resources with candidates'),
  ('batches.view',            'View batches and rosters'),
  ('batches.manage',          'Create and edit batches'),
  ('enrollments.manage',      'Create and update enrollments'),
  ('sessions.view',           'View the class calendar'),
  ('sessions.manage',         'Create, update and cancel class sessions'),
  ('attendance.record',       'Record attendance'),
  ('finance.view',            'View fees, payments, refunds and expenses'),
  ('finance.manage',          'Record payments, installments, refunds and expenses'),
  ('marketing.view',          'View campaigns and attribution'),
  ('marketing.manage',        'Create campaigns, links and templates'),
  ('reports.view',            'View analytics and reports'),
  ('reports.export',          'Export reports to CSV'),
  ('settings.manage',         'Change business settings'),
  ('members.manage',          'Invite and manage staff and instructors'),
  ('integrations.manage',     'Connect Google, email and other providers'),
  ('audit.view',              'View the audit log')
on conflict do nothing;

-- Owner implicitly has everything (see has_permission); listed for completeness.
insert into public.role_permissions (role, permission_key)
select 'owner'::public.member_role, key from public.permissions
on conflict do nothing;

insert into public.role_permissions (role, permission_key)
select 'admin'::public.member_role, key from public.permissions
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('staff', 'dashboard.view'),
  ('staff', 'courses.view'),
  ('staff', 'candidates.view_assigned'),
  ('staff', 'candidates.manage'),
  ('staff', 'resources.view'),
  ('staff', 'resources.share'),
  ('staff', 'batches.view'),
  ('staff', 'enrollments.manage'),
  ('staff', 'sessions.view'),
  ('staff', 'marketing.view'),
  ('instructor', 'dashboard.view'),
  ('instructor', 'courses.view'),
  ('instructor', 'resources.view'),
  ('instructor', 'resources.manage'),
  ('instructor', 'batches.view'),
  ('instructor', 'sessions.view'),
  ('instructor', 'attendance.record')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Authorization functions (used by RLS policies and by the app)
-- -----------------------------------------------------------------------------

-- Active membership of the current user in an org, honouring the org's
-- staff / instructor feature switches.
create or replace function public.current_membership(org_id uuid)
returns public.organization_memberships
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.organization_id = org_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and (
      m.role in ('owner', 'admin')
      or (m.role = 'staff' and o.staff_enabled)
      or (m.role = 'instructor' and o.instructors_enabled)
    )
  limit 1;
$$;

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.current_membership(org_id)).id is not null;
$$;

create or replace function public.has_permission(org_id uuid, permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.organization_memberships;
  override_allowed boolean;
begin
  m := public.current_membership(org_id);
  if m.id is null then
    return false;
  end if;
  if m.role = 'owner' then
    return true;
  end if;

  select o.allowed into override_allowed
  from public.membership_permission_overrides o
  where o.membership_id = m.id and o.permission_key = permission;

  if override_allowed is not null then
    return override_allowed;
  end if;

  return exists (
    select 1 from public.role_permissions rp
    where rp.role = m.role and rp.permission_key = permission
  );
end;
$$;

-- Everything the app shell needs about the signed-in user, in one round trip.
create or replace function public.get_my_access()
returns table (
  organization_id   uuid,
  organization_name text,
  organization_slug text,
  timezone          text,
  default_currency  char(3),
  membership_id     uuid,
  role              public.member_role,
  permissions       text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id, o.name, o.slug, o.timezone, o.default_currency, m.id, m.role,
    array(
      select p.key from public.permissions p
      where public.has_permission(o.id, p.key)
      order by p.key
    )
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and public.is_org_member(o.id)
  order by m.created_at;
$$;

-- -----------------------------------------------------------------------------
-- Membership integrity rules
-- -----------------------------------------------------------------------------

create or replace function public.enforce_membership_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_role public.member_role;
  org uuid := coalesce(new.organization_id, old.organization_id);
  remaining_owners int;
begin
  -- Service-role / migrations / bootstrap run without a user: allow, but the
  -- last-owner rule below still applies.
  if actor is not null then
    actor_role := (public.current_membership(org)).role;

    if actor_role is null then
      raise exception 'Not a member of this organization' using errcode = '42501';
    end if;

    if tg_op in ('UPDATE', 'DELETE') and old.user_id = actor then
      raise exception 'You cannot change or remove your own membership' using errcode = '42501';
    end if;

    if actor_role is distinct from 'owner' then
      if tg_op in ('INSERT', 'UPDATE') and new.role in ('owner', 'admin') then
        raise exception 'Only the owner can grant owner or admin access' using errcode = '42501';
      end if;
      if tg_op in ('UPDATE', 'DELETE') and old.role in ('owner', 'admin') then
        raise exception 'Only the owner can change owner or admin memberships' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'Memberships cannot move between organizations' using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    select count(*) into remaining_owners
    from public.organization_memberships
    where organization_id = old.organization_id
      and role = 'owner' and status = 'active' and id <> old.id;
    if remaining_owners = 0 then
      raise exception 'An organization must keep at least one active owner' using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists organization_memberships_rules on public.organization_memberships;
create trigger organization_memberships_rules
  before insert or update or delete on public.organization_memberships
  for each row execute function public.enforce_membership_rules();

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------

create table if not exists public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  actor_id         uuid references public.user_profiles (id) on delete set null,
  action           text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type      text,
  entity_id        uuid,
  details          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit log entries are immutable' using errcode = '42501';
end;
$$;

drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();

-- App-facing writer: the actor is always the authenticated user, never a
-- client-supplied id.
create or replace function public.write_audit_log(
  p_organization_id uuid,
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Settings changes are audited in the database so they cannot be skipped.
create or replace function public.audit_organization_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed jsonb;
begin
  select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value and n.key not in ('updated_at');

  if changed <> '{}'::jsonb then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
    values (new.id, auth.uid(), 'settings.updated', 'organization', new.id, jsonb_build_object('changed', changed));
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_audit on public.organizations;
create trigger organizations_audit
  after update on public.organizations
  for each row execute function public.audit_organization_update();

create or replace function public.audit_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.organization_memberships := coalesce(new, old);
begin
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    rec.organization_id,
    auth.uid(),
    case tg_op when 'INSERT' then 'member.added' when 'UPDATE' then 'member.updated' else 'member.removed' end,
    'membership',
    rec.id,
    jsonb_build_object('user_id', rec.user_id, 'role', rec.role, 'status', rec.status,
                       'previous_role', case when tg_op = 'UPDATE' then old.role end,
                       'previous_status', case when tg_op = 'UPDATE' then old.status end)
  );
  return rec;
end;
$$;

drop trigger if exists organization_memberships_audit on public.organization_memberships;
create trigger organization_memberships_audit
  after insert or update or delete on public.organization_memberships
  for each row execute function public.audit_membership_change();

-- -----------------------------------------------------------------------------
-- First-owner bootstrap (service role only; works exactly once)
-- -----------------------------------------------------------------------------

create or replace function public.bootstrap_organization(
  p_user_id uuid,
  p_org_name text,
  p_org_slug text,
  p_full_name text default null,
  p_timezone text default 'Asia/Kolkata',
  p_currency char(3) default 'INR'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
begin
  -- Serialise concurrent setup attempts.
  lock table public.organizations in share row exclusive mode;

  if exists (select 1 from public.organizations) then
    raise exception 'Setup has already been completed' using errcode = '55000';
  end if;

  if not exists (select 1 from public.user_profiles where id = p_user_id) then
    raise exception 'User profile not found' using errcode = '23503';
  end if;

  if p_full_name is not null then
    update public.user_profiles set full_name = btrim(p_full_name) where id = p_user_id;
  end if;

  insert into public.organizations (name, slug, timezone, default_currency)
  values (btrim(p_org_name), p_org_slug, p_timezone, p_currency)
  returning id into new_org;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (new_org, p_user_id, 'owner', 'active');

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (new_org, p_user_id, 'setup.completed', 'organization', new_org, '{}'::jsonb);

  return new_org;
end;
$$;

create or replace function public.setup_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.organizations);
$$;

-- Connectivity probe for /api/health. Reveals nothing.
create or replace function public.health_check()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.organizations                   enable row level security;
alter table public.user_profiles                   enable row level security;
alter table public.organization_memberships        enable row level security;
alter table public.permissions                     enable row level security;
alter table public.role_permissions                enable row level security;
alter table public.membership_permission_overrides enable row level security;
alter table public.audit_logs                      enable row level security;

-- organizations
drop policy if exists "members read their organization" on public.organizations;
create policy "members read their organization"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

drop policy if exists "settings managers update their organization" on public.organizations;
create policy "settings managers update their organization"
  on public.organizations for update to authenticated
  using (public.has_permission(id, 'settings.manage'))
  with check (public.has_permission(id, 'settings.manage'));

-- user_profiles
drop policy if exists "users read own profile and teammates" on public.user_profiles;
create policy "users read own profile and teammates"
  on public.user_profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.organization_memberships m
      where m.user_id = user_profiles.id and public.is_org_member(m.organization_id)
    )
  );

drop policy if exists "users update own profile" on public.user_profiles;
create policy "users update own profile"
  on public.user_profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organization_memberships
drop policy if exists "members read memberships of their organization" on public.organization_memberships;
create policy "members read memberships of their organization"
  on public.organization_memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_member(organization_id));

drop policy if exists "member managers add memberships" on public.organization_memberships;
create policy "member managers add memberships"
  on public.organization_memberships for insert to authenticated
  with check (public.has_permission(organization_id, 'members.manage'));

drop policy if exists "member managers update memberships" on public.organization_memberships;
create policy "member managers update memberships"
  on public.organization_memberships for update to authenticated
  using (public.has_permission(organization_id, 'members.manage'))
  with check (public.has_permission(organization_id, 'members.manage'));

drop policy if exists "member managers remove memberships" on public.organization_memberships;
create policy "member managers remove memberships"
  on public.organization_memberships for delete to authenticated
  using (public.has_permission(organization_id, 'members.manage'));

-- permission catalog (not secret, read-only)
drop policy if exists "authenticated read permission catalog" on public.permissions;
create policy "authenticated read permission catalog"
  on public.permissions for select to authenticated using (true);

drop policy if exists "authenticated read role defaults" on public.role_permissions;
create policy "authenticated read role defaults"
  on public.role_permissions for select to authenticated using (true);

-- overrides
drop policy if exists "member managers and the member read overrides" on public.membership_permission_overrides;
create policy "member managers and the member read overrides"
  on public.membership_permission_overrides for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.id = membership_id
      and (m.user_id = (select auth.uid()) or public.has_permission(m.organization_id, 'members.manage'))
  ));

drop policy if exists "member managers write overrides" on public.membership_permission_overrides;
create policy "member managers write overrides"
  on public.membership_permission_overrides for all to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.id = membership_id and m.role not in ('owner')
      and m.user_id <> (select auth.uid())
      and public.has_permission(m.organization_id, 'members.manage')
  ))
  with check (exists (
    select 1 from public.organization_memberships m
    where m.id = membership_id and m.role not in ('owner')
      and m.user_id <> (select auth.uid())
      and public.has_permission(m.organization_id, 'members.manage')
  ));

-- audit_logs: read-only for auditors; writes only via definer functions/triggers
drop policy if exists "auditors read audit log" on public.audit_logs;
create policy "auditors read audit log"
  on public.audit_logs for select to authenticated
  using (public.has_permission(organization_id, 'audit.view'));

-- -----------------------------------------------------------------------------
-- Grants (least privilege; RLS still applies on top)
-- -----------------------------------------------------------------------------

revoke all on public.organizations, public.user_profiles, public.organization_memberships,
  public.permissions, public.role_permissions, public.membership_permission_overrides,
  public.audit_logs
  from anon, authenticated;

grant select, update on public.organizations to authenticated;
grant select on public.user_profiles to authenticated;
grant update (full_name) on public.user_profiles to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select on public.permissions, public.role_permissions to authenticated;
grant select, insert, update, delete on public.membership_permission_overrides to authenticated;
grant select on public.audit_logs to authenticated;

-- Functions: Postgres grants EXECUTE to PUBLIC by default; tighten that.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.health_check() to anon, authenticated;
grant execute on function public.setup_required() to anon, authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.current_membership(uuid) to authenticated;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.write_audit_log(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.is_valid_timezone(text) to authenticated;

grant execute on function public.bootstrap_organization(uuid, text, text, text, text, char) to service_role;
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Supabase applies default privileges that grant new functions to anon and
-- authenticated. Each later migration must explicitly re-revoke and grant.
alter default privileges in schema public revoke execute on functions from public;


-- >>>>>>>>>>>>>>>>>>>> 20261014000002_rate_limits.sql

-- =============================================================================
-- Fixed-window rate limiter for login, first-admin setup and (from Phase 2)
-- public registration forms. Works on Vercel's serverless runtime because the
-- counter lives in Postgres, not in process memory.
-- Keys are hashed by the app (never raw IPs or emails).
-- =============================================================================

create table if not exists public.rate_limit_buckets (
  key           text primary key check (char_length(key) <= 200),
  window_start  timestamptz not null,
  hits          integer not null check (hits >= 0)
);

create index if not exists rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;
-- No policies: only the service role (which bypasses RLS) may touch it.
revoke all on public.rate_limit_buckets from anon, authenticated;

-- Returns true when the call is allowed, false when the limit is exceeded.
create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  new_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, current_window, 1)
  on conflict (key) do update
    set hits = case when b.window_start = excluded.window_start then b.hits + 1 else 1 end,
        window_start = excluded.window_start
  returning hits into new_hits;

  -- Opportunistic cleanup of stale buckets (cheap thanks to the index).
  if random() < 0.01 then
    delete from public.rate_limit_buckets where window_start < now() - interval '1 day';
  end if;

  return new_hits <= p_limit;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant all on public.rate_limit_buckets to service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000003_courses_candidates.sql

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


-- >>>>>>>>>>>>>>>>>>>> 20261014000004_crm_import.sql

-- =============================================================================
-- Adrenaline Rush: candidate CRM helpers (roadmap phase 3)
--   * last_activity_at on candidates (kept fresh by the timeline)
--   * owner and lead-status integrity rules
--   * owner picker, duplicate lookups and atomic CSV import
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Last activity (sortable in the candidate list)
-- -----------------------------------------------------------------------------

alter table public.candidates add column if not exists last_activity_at timestamptz;

update public.candidates c
   set last_activity_at = coalesce(
         (select max(a.created_at) from public.candidate_activities a where a.candidate_id = c.id),
         c.created_at)
 where c.last_activity_at is null;

alter table public.candidates alter column last_activity_at set default now();

create index if not exists candidates_last_activity_idx
  on public.candidates (organization_id, last_activity_at desc nulls last);

create or replace function public.candidate_activities_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.candidates
     set last_activity_at = greatest(coalesce(last_activity_at, new.created_at), new.created_at)
   where id = new.candidate_id;
  return new;
end;
$$;
drop trigger if exists candidate_activities_touch on public.candidate_activities;
create trigger candidate_activities_touch after insert on public.candidate_activities
  for each row execute function public.candidate_activities_touch();

-- -----------------------------------------------------------------------------
-- Integrity rules
-- -----------------------------------------------------------------------------

-- A candidate can only be owned by an active member of the same organization.
create or replace function public.candidates_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.organization_memberships m
     where m.organization_id = new.organization_id and m.user_id = new.owner_id and m.status = 'active'
  ) then
    raise exception 'Owner must be an active member of this organization' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists candidates_check_owner on public.candidates;
create trigger candidates_check_owner before insert or update of owner_id, organization_id on public.candidates
  for each row execute function public.candidates_check_owner();

-- Lead statuses in use (and the default "new" status) cannot be deleted.
-- Deleting the whole organization still cascades.
create or replace function public.lead_statuses_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.organizations where id = old.organization_id) then
    if old.key = 'new' then
      raise exception 'The default "new" status cannot be deleted' using errcode = '23514';
    end if;
    if exists (select 1 from public.candidates where lead_status_id = old.id) then
      raise exception 'Lead status is in use by candidates' using errcode = '23503';
    end if;
  end if;
  return old;
end;
$$;
drop trigger if exists lead_statuses_guard_delete on public.lead_statuses;
create trigger lead_statuses_guard_delete before delete on public.lead_statuses
  for each row execute function public.lead_statuses_guard_delete();

-- -----------------------------------------------------------------------------
-- Owner picker: active members who hold candidates.manage
-- -----------------------------------------------------------------------------

create or replace function public.list_candidate_owners(p_org uuid)
returns table (user_id uuid, full_name text, email text, role public.member_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.full_name, p.email, m.role
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  join public.user_profiles p on p.id = m.user_id
  where m.organization_id = p_org
    and m.status = 'active'
    and public.is_org_member(p_org)
    and (
      m.role in ('owner', 'admin')
      or (m.role = 'staff' and o.staff_enabled)
      or (m.role = 'instructor' and o.instructors_enabled)
    )
    and (
      m.role = 'owner'
      or coalesce(
        (select ov.allowed from public.membership_permission_overrides ov
          where ov.membership_id = m.id and ov.permission_key = 'candidates.manage'),
        exists (select 1 from public.role_permissions rp
                 where rp.role = m.role and rp.permission_key = 'candidates.manage')
      )
    )
  order by coalesce(p.full_name, p.email);
$$;

-- -----------------------------------------------------------------------------
-- Duplicate lookups. Run as definer so staff who only see their assigned
-- candidates still cannot create duplicates of records they cannot see; the
-- name is only returned for records the caller may view.
-- -----------------------------------------------------------------------------

create or replace function public.find_candidate_duplicates(
  p_org uuid,
  p_email text,
  p_phone text,
  p_exclude uuid default null
)
returns table (candidate_id uuid, matched_on text, can_view boolean, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  e_norm text := public.normalize_email(p_email);
  p_k text := public.phone_match_key(p_phone);
begin
  if not (public.has_permission(p_org, 'candidates.manage') or public.has_permission(p_org, 'candidates.import')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if e_norm is null and p_k is null then
    return;
  end if;
  return query
  select c.id,
         case when e_norm is not null and c.email_normalized = e_norm then 'email' else 'phone' end,
         coalesce(public.can_view_candidate(c.organization_id, c.owner_id), false),
         case when public.can_view_candidate(c.organization_id, c.owner_id) then c.full_name end
  from public.candidates c
  where c.organization_id = p_org
    and (p_exclude is null or c.id <> p_exclude)
    and ((e_norm is not null and c.email_normalized = e_norm) or (p_k is not null and c.phone_key = p_k))
  order by c.created_at
  limit 5;
end;
$$;

-- Which of these (already normalised) emails / phone keys exist? Used by the
-- import preview; returns only keys the caller sent.
create or replace function public.find_existing_candidate_keys(p_org uuid, p_emails text[], p_phone_keys text[])
returns table (kind text, key text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(p_org, 'candidates.import') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_emails, 1), 0) > 5000 or coalesce(array_length(p_phone_keys, 1), 0) > 5000 then
    raise exception 'Too many keys' using errcode = '22023';
  end if;
  return query
    select distinct 'email'::text, c.email_normalized
      from public.candidates c
     where c.organization_id = p_org and c.email_normalized = any (p_emails)
    union
    select distinct 'phone'::text, c.phone_key
      from public.candidates c
     where c.organization_id = p_org and c.phone_key = any (p_phone_keys);
end;
$$;

-- -----------------------------------------------------------------------------
-- CSV import: one transaction, deduplicated against existing candidates and
-- earlier rows of the same file. Invalid rows are skipped and reported.
-- Rows: [{ full_name, email, phone, company, job_title, city, country, source,
--          utm_source, utm_medium, utm_campaign, notes, lead_status, course_slug }]
-- -----------------------------------------------------------------------------

create or replace function public.import_candidates(
  p_org uuid,
  p_rows jsonb,
  p_owner_id uuid default null,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  owner uuid := p_owner_id;
  batch uuid := gen_random_uuid();
  r jsonb;
  idx integer;
  v_name text;
  v_email text;
  v_phone text;
  v_status text;
  v_course text;
  v_notes text;
  e_norm text;
  p_k text;
  status_id uuid;
  crs_id uuid;
  crs_title text;
  match_id uuid;
  cand_id uuid;
  reason text;
  created_ids uuid[] := '{}';
  n_created integer := 0;
  n_duplicate integer := 0;
  n_invalid integer := 0;
  results jsonb := '[]'::jsonb;
begin
  if actor is null or not public.has_permission(p_org, 'candidates.import') then
    raise exception 'You do not have permission to import candidates' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Too many rows (maximum 5000)' using errcode = '22023';
  end if;

  -- Staff limited to their assigned candidates import records they own.
  if not public.has_permission(p_org, 'candidates.view_all') then
    owner := actor;
  end if;
  if owner is not null and not exists (
    select 1 from public.organization_memberships m
     where m.organization_id = p_org and m.user_id = owner and m.status = 'active'
  ) then
    raise exception 'Owner must be an active member of this organization' using errcode = '23503';
  end if;

  for r, idx in select e.value, e.ordinality::integer from jsonb_array_elements(p_rows) with ordinality as e loop
    reason := null;
    status_id := null;
    crs_id := null;
    crs_title := null;
    match_id := null;

    if jsonb_typeof(r) <> 'object' then
      n_invalid := n_invalid + 1;
      results := results || jsonb_build_object('row', idx, 'status', 'invalid', 'reason', 'Row is not an object');
      continue;
    end if;

    v_name := nullif(btrim(r ->> 'full_name'), '');
    v_email := nullif(btrim(r ->> 'email'), '');
    v_phone := nullif(btrim(r ->> 'phone'), '');
    v_status := nullif(btrim(r ->> 'lead_status'), '');
    v_course := nullif(lower(btrim(r ->> 'course_slug')), '');
    v_notes := nullif(btrim(r ->> 'notes'), '');
    e_norm := public.normalize_email(v_email);
    p_k := public.phone_match_key(v_phone);

    if v_name is null then
      reason := 'Name is required';
    elsif e_norm is null and p_k is null then
      reason := 'Email or phone is required';
    elsif v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      reason := 'Email address is not valid';
    end if;

    if reason is null and v_status is not null then
      select s.id into status_id from public.lead_statuses s
       where s.organization_id = p_org and (s.key = lower(v_status) or lower(s.label) = lower(v_status))
       order by s.position limit 1;
      if status_id is null then
        reason := 'Unknown lead status';
      end if;
    end if;

    if reason is null and v_course is not null then
      select c.id, c.title into crs_id, crs_title from public.courses c
       where c.organization_id = p_org and c.slug = v_course;
      if crs_id is null then
        reason := 'Unknown course';
      end if;
    end if;

    if reason is not null then
      n_invalid := n_invalid + 1;
      results := results || jsonb_build_object('row', idx, 'status', 'invalid', 'reason', reason);
      continue;
    end if;

    -- Same lock key as submit_registration, so a simultaneous public
    -- registration for the same person cannot race this row.
    perform pg_advisory_xact_lock(hashtext(coalesce(e_norm, '') || '|' || coalesce(p_k, '')));

    select c.id into match_id from public.candidates c
     where c.organization_id = p_org
       and ((e_norm is not null and c.email_normalized = e_norm) or (p_k is not null and c.phone_key = p_k))
     order by c.created_at
     limit 1;

    if match_id is not null then
      n_duplicate := n_duplicate + 1;
      results := results || jsonb_build_object(
        'row', idx,
        'status', 'duplicate',
        'reason', case when match_id = any (created_ids) then 'Duplicate of an earlier row in this file'
                       else 'Matches an existing candidate' end,
        'candidate_id', case when match_id = any (created_ids) or public.can_view_candidate_id(match_id) then match_id end);
      continue;
    end if;

    begin
      insert into public.candidates (
        organization_id, full_name, email, phone, company, job_title, city, country,
        source, utm_source, utm_medium, utm_campaign, lead_status_id, owner_id, created_by
      ) values (
        p_org, v_name, v_email, v_phone,
        nullif(btrim(r ->> 'company'), ''), nullif(btrim(r ->> 'job_title'), ''),
        nullif(btrim(r ->> 'city'), ''), nullif(btrim(r ->> 'country'), ''),
        coalesce(nullif(btrim(r ->> 'source'), ''), 'import'),
        nullif(btrim(r ->> 'utm_source'), ''), nullif(btrim(r ->> 'utm_medium'), ''), nullif(btrim(r ->> 'utm_campaign'), ''),
        status_id, owner, actor
      ) returning id into cand_id;

      if crs_id is not null then
        insert into public.course_registrations (organization_id, candidate_id, course_id, answers, channel,
          utm_source, utm_medium, utm_campaign)
        values (p_org, cand_id, crs_id, '{}'::jsonb, 'import',
          nullif(btrim(r ->> 'utm_source'), ''), nullif(btrim(r ->> 'utm_medium'), ''), nullif(btrim(r ->> 'utm_campaign'), ''));
      end if;

      insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
      values (p_org, cand_id, 'imported',
              'Imported from CSV' || coalesce(' for ' || crs_title, ''),
              jsonb_build_object('batch_id', batch, 'row', idx, 'file_name', left(p_file_name, 200), 'course_id', crs_id),
              actor);

      if v_notes is not null then
        insert into public.candidate_notes (organization_id, candidate_id, body, author_id)
        values (p_org, cand_id, left(v_notes, 5000), actor);
      end if;

      created_ids := created_ids || cand_id;
      n_created := n_created + 1;
      results := results || jsonb_build_object('row', idx, 'status', 'created', 'candidate_id', cand_id);
    exception
      when check_violation or string_data_right_truncation or invalid_text_representation
        or not_null_violation or numeric_value_out_of_range then
        n_invalid := n_invalid + 1;
        results := results || jsonb_build_object('row', idx, 'status', 'invalid', 'reason', 'A value is too long or not allowed');
    end;
  end loop;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, actor, 'candidates.import', 'candidates', null,
          jsonb_build_object('batch_id', batch, 'rows', jsonb_array_length(p_rows), 'created', n_created,
                             'duplicates', n_duplicate, 'invalid', n_invalid));

  return jsonb_build_object('batch_id', batch, 'created', n_created, 'duplicates', n_duplicate,
                            'invalid', n_invalid, 'results', results);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants (re-stated in full: Supabase default privileges grant new functions
-- to anon and authenticated, so every migration revokes and re-grants)
-- -----------------------------------------------------------------------------

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
grant execute on function public.list_candidate_owners(uuid) to authenticated;
grant execute on function public.find_candidate_duplicates(uuid, text, text, uuid) to authenticated;
grant execute on function public.find_existing_candidate_keys(uuid, text[], text[]) to authenticated;
grant execute on function public.import_candidates(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on all functions in schema public to service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000005_course_content.sql

-- =============================================================================
-- Adrenaline Rush: course page content and public website settings
--   * courses: "What's included" list, registration mode (free demo / register
--     interest), button label and highlight badge
--   * site_settings: one row per organization, edited under
--     Settings › Website and read publicly through get_public_site()
--   * public RPCs return the new course fields
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Course content
-- -----------------------------------------------------------------------------

-- [{ "title": "...", "description": "...", "icon": "mic" }]; the icon names are
-- an allowlist kept in src/lib/validation/courses.ts (unknown names render a
-- check mark).
alter table public.courses add column if not exists inclusions jsonb not null default '[]'::jsonb
  check (case when jsonb_typeof(inclusions) = 'array' then jsonb_array_length(inclusions) <= 20 else false end);

-- demo: the course page books a free demo class (registrations use channel
-- 'demo_request'); interest: a plain "register your interest" form.
alter table public.courses add column if not exists registration_mode text not null default 'demo'
  check (registration_mode in ('demo', 'interest'));

-- Main button text on the course page; null means the default for the mode.
alter table public.courses add column if not exists cta_label text
  check (cta_label is null or char_length(btrim(cta_label)) between 1 and 40);

-- Short announcement shown in the course hero, e.g. "Next demo: Saturday 11 AM".
alter table public.courses add column if not exists highlight_badge text
  check (highlight_badge is null or char_length(btrim(highlight_badge)) between 1 and 80);

-- -----------------------------------------------------------------------------
-- Website settings (one row per organization)
-- -----------------------------------------------------------------------------

create table if not exists public.site_settings (
  organization_id      uuid primary key references public.organizations (id) on delete cascade,
  hero_title           text check (hero_title is null or char_length(hero_title) <= 140),
  hero_subtitle        text check (hero_subtitle is null or char_length(hero_subtitle) <= 400),
  hero_badge           text check (hero_badge is null or char_length(hero_badge) <= 80),
  featured_course_id   uuid references public.courses (id) on delete set null,
  about_text           text check (about_text is null or char_length(about_text) <= 4000),
  contact_email        text check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  contact_phone        text check (contact_phone is null or contact_phone ~ '^\+?[0-9 ()-]{6,32}$'),
  whatsapp_number      text check (whatsapp_number is null or whatsapp_number ~ '^\+?[0-9 ()-]{6,32}$'),
  address              text check (address is null or char_length(address) <= 500),
  linkedin_url         text check (linkedin_url is null or (char_length(linkedin_url) <= 500 and linkedin_url ~* '^https://\S+$')),
  instagram_url        text check (instagram_url is null or (char_length(instagram_url) <= 500 and instagram_url ~* '^https://\S+$')),
  youtube_url          text check (youtube_url is null or (char_length(youtube_url) <= 500 and youtube_url ~* '^https://\S+$')),
  x_url                text check (x_url is null or (char_length(x_url) <= 500 and x_url ~* '^https://\S+$')),
  facebook_url         text check (facebook_url is null or (char_length(facebook_url) <= 500 and facebook_url ~* '^https://\S+$')),
  footer_tagline       text check (footer_tagline is null or char_length(footer_tagline) <= 300),
  show_course_catalog  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists site_settings_updated_at on public.site_settings;
create trigger site_settings_updated_at before update on public.site_settings
  for each row execute function public.set_updated_at();

-- Every organization gets a settings row (and existing ones are backfilled).
create or replace function public.site_settings_seed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.site_settings (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.site_settings_seed() from public, anon, authenticated;
grant execute on function public.site_settings_seed() to service_role;

drop trigger if exists organizations_seed_site_settings on public.organizations;
create trigger organizations_seed_site_settings after insert on public.organizations
  for each row execute function public.site_settings_seed();

insert into public.site_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "settings managers read site settings" on public.site_settings;
create policy "settings managers read site settings" on public.site_settings for select to authenticated
  using (public.has_permission(organization_id, 'settings.manage'));
drop policy if exists "settings managers update site settings" on public.site_settings;
create policy "settings managers update site settings" on public.site_settings for update to authenticated
  using (public.has_permission(organization_id, 'settings.manage'))
  with check (
    public.has_permission(organization_id, 'settings.manage')
    and (featured_course_id is null or public.course_org(featured_course_id) = organization_id)
  );

-- Rows are created by the trigger only; nobody inserts or deletes them via the API.
revoke all on public.site_settings from anon, authenticated;
grant select, update on public.site_settings to authenticated;
grant all on public.site_settings to service_role;

-- -----------------------------------------------------------------------------
-- Public read API (same signatures; existing grants are kept)
-- -----------------------------------------------------------------------------

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
    'inclusions', c.inclusions,
    'registration_mode', c.registration_mode,
    'cta_label', c.cta_label,
    'highlight_badge', c.highlight_badge,
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
      'inclusions', c.inclusions,
      'registration_mode', c.registration_mode,
      'cta_label', c.cta_label,
      'highlight_badge', c.highlight_badge,
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

-- Public-safe website settings for the primary organization. The featured
-- course is only returned while it is published.
create or replace function public.get_public_site()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organization_name', o.name,
    'hero_title', s.hero_title,
    'hero_subtitle', s.hero_subtitle,
    'hero_badge', s.hero_badge,
    'about_text', s.about_text,
    'contact_email', s.contact_email,
    'contact_phone', s.contact_phone,
    'whatsapp_number', s.whatsapp_number,
    'address', s.address,
    'social', jsonb_build_object(
      'linkedin', s.linkedin_url, 'instagram', s.instagram_url, 'youtube', s.youtube_url,
      'x', s.x_url, 'facebook', s.facebook_url),
    'footer_tagline', s.footer_tagline,
    'show_course_catalog', coalesce(s.show_course_catalog, true),
    'featured_course', (
      select jsonb_build_object(
        'slug', c.slug, 'title', c.title, 'short_description', c.short_description,
        'cover_image_url', c.cover_image_url, 'duration_text', c.duration_text, 'delivery_mode', c.delivery_mode,
        'level', c.level, 'highlight_badge', c.highlight_badge, 'cta_label', c.cta_label,
        'registration_mode', c.registration_mode, 'registration_open', public.course_is_open(c))
      from public.courses c
      where c.id = s.featured_course_id and c.organization_id = o.id and c.status = 'published')
  )
  from public.organizations o
  left join public.site_settings s on s.organization_id = o.id
  where o.id = public.primary_organization_id();
$$;
revoke execute on function public.get_public_site() from public;
grant execute on function public.get_public_site() to anon, authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000006_email.sql

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


-- >>>>>>>>>>>>>>>>>>>> 20261014000007_shorter_registration_form.sql

-- =============================================================================
-- Shorter default registration form for new courses.
-- Owners asked to keep the candidate side minimal: new courses start with name,
-- email, phone, current role, experience, "how did you hear about us" and the
-- two consent boxes. The other standard fields are still created but hidden;
-- switch them on in Courses › Registration form. Existing courses are unchanged.
-- Re-running is safe. No new functions, so the grant list is unchanged.
-- =============================================================================

create or replace function public.seed_course_registration_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.course_registration_fields (course_id, key, label, type, maps_to, required, options, position, placeholder, help_text, is_active)
  values
    (new.id, 'full_name', 'Full name', 'text', 'full_name', true, '{}', 10, null, null, true),
    (new.id, 'email', 'Email address', 'email', 'email', true, '{}', 20, 'you@example.com', null, true),
    (new.id, 'phone', 'Phone (with country code)', 'phone', 'phone', true, '{}', 30, '+91 98765 43210', null, true),
    (new.id, 'city', 'City', 'text', 'city', false, '{}', 40, null, null, false),
    (new.id, 'country', 'Country', 'text', 'country', false, '{}', 50, null, null, false),
    (new.id, 'company', 'Current company', 'text', 'company', false, '{}', 60, null, null, false),
    (new.id, 'job_title', 'Current job title', 'text', 'job_title', false, '{}', 70, null, null, true),
    (new.id, 'total_experience_years', 'Total experience (years)', 'number', 'total_experience_years', false, '{}', 80, null, null, true),
    (new.id, 'relevant_experience_years', 'Relevant experience (years)', 'number', 'relevant_experience_years', false, '{}', 90, null, null, false),
    (new.id, 'skills', 'Current skills', 'textarea', 'skills', false, '{}', 100, null, null, false),
    (new.id, 'learning_objectives', 'What do you want to achieve?', 'textarea', 'learning_objectives', false, '{}', 110, null, null, false),
    (new.id, 'preferred_schedule', 'Preferred schedule', 'select', 'preferred_schedule', false, array['Weekdays', 'Weekends', 'Evenings', 'Flexible'], 120, null, null, false),
    (new.id, 'employment_status', 'Employment status', 'select', 'employment_status', false, array['Employed', 'Student', 'Looking for work', 'Freelancer', 'Other'], 130, null, null, false),
    (new.id, 'heard_about', 'How did you hear about us?', 'select', 'heard_about', false, array['LinkedIn', 'WhatsApp', 'Telegram', 'Friend or colleague', 'Search', 'Other'], 140, null, null, true),
    (new.id, 'marketing_consent', 'I agree to receive course updates by email, phone or WhatsApp', 'checkbox', 'marketing_consent', false, '{}', 900, null, 'You can opt out at any time.', true),
    (new.id, 'privacy_consent', 'I agree to the privacy policy', 'consent', 'privacy_consent', true, '{}', 910, null, null, true)
  on conflict (course_id, key) do nothing;
  return new;
end;
$$;
