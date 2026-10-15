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
-- Contains: 20261014000001_foundation.sql, 20261014000002_rate_limits.sql, 20261014000003_courses_candidates.sql, 20261014000004_crm_import.sql, 20261014000005_course_content.sql, 20261014000006_email.sql, 20261014000007_shorter_registration_form.sql, 20261014000008_team_invitations.sql, 20261014000009_demos_resources.sql, 20261014000010_batches_sessions.sql, 20261014000011_finance.sql, 20261014000012_analytics.sql, 20261014000013_upi_payments.sql, 20261014000014_custom_roles.sql, 20261014000015_course_cover_paths.sql
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


-- >>>>>>>>>>>>>>>>>>>> 20261014000008_team_invitations.sql

-- =============================================================================
-- Adrenaline Rush: team invitations and member management
--   * team_invitations   single-use, hashed, expiring invitations for admins,
--                        staff and instructors (the raw token is never stored)
--   * rules              only the owner invites/alters administrators; closed
--                        invitations cannot be reopened; existing members
--                        cannot be invited again
--   * accept             service-role function that turns an invitation into an
--                        active membership in one transaction
--   * permission overrides: only the owner touches admin overrides, and nobody
--                        grants a permission they do not hold themselves
--   * audit              invites, resends, revocations, acceptances and
--                        permission override changes are written to audit_logs
--   * "Team invitation" email template (editable in Marketing > Emails)
-- Safe to re-run.
-- =============================================================================

create table if not exists public.team_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null check (
                     char_length(email) <= 254
                     and email = lower(btrim(email))
                     and email ~* '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$'),
  full_name        text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone            text check (phone is null or char_length(phone) <= 32),
  role             public.member_role not null check (role in ('admin', 'staff', 'instructor')),
  -- sha256 (hex) of the random token in the invitation link.
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at       timestamptz not null,
  invited_by       uuid references public.user_profiles (id) on delete set null,
  accepted_by      uuid references public.user_profiles (id) on delete set null,
  accepted_at      timestamptz,
  revoked_by       uuid references public.user_profiles (id) on delete set null,
  revoked_at       timestamptz,
  membership_id    uuid references public.organization_memberships (id) on delete set null,
  send_count       integer not null default 0 check (send_count between 0 and 1000),
  last_sent_at     timestamptz,
  -- Outcome of the last invitation email (null when none was attempted).
  email_status     text check (email_status is null or email_status in ('sent', 'failed', 'not_sent')),
  email_error      text check (email_error is null or char_length(email_error) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists team_invitations_one_pending_idx
  on public.team_invitations (organization_id, email) where status = 'pending';
create index if not exists team_invitations_org_idx on public.team_invitations (organization_id, created_at desc);

drop trigger if exists team_invitations_updated_at on public.team_invitations;
create trigger team_invitations_updated_at before update on public.team_invitations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Rules for app users (the service role, used only by the accept flow, skips
-- the actor checks but not the data checks).
-- -----------------------------------------------------------------------------

create or replace function public.team_invitations_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_role public.member_role;
begin
  if tg_op = 'UPDATE' then
    -- Removing the member clears the link to their membership (on delete set null).
    if new.membership_id is null and old.membership_id is not null
       and (to_jsonb(new) - 'membership_id' - 'updated_at') = (to_jsonb(old) - 'membership_id' - 'updated_at') then
      return new;
    end if;
    if new.organization_id <> old.organization_id or new.email <> old.email or new.role <> old.role
       or new.invited_by is distinct from old.invited_by or new.created_at <> old.created_at then
      raise exception 'Invitations cannot be edited. Revoke it and send a new one.' using errcode = '42501';
    end if;
  end if;

  if actor is not null then
    actor_role := (public.current_membership(new.organization_id)).role;
    if actor_role is null then
      raise exception 'Not a member of this organization' using errcode = '42501';
    end if;
    if actor_role <> 'owner' and new.role = 'admin' then
      raise exception 'Only the owner can invite administrators' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      new.invited_by := actor;
      if new.status <> 'pending' or new.accepted_by is not null or new.accepted_at is not null
         or new.membership_id is not null or new.revoked_by is not null or new.revoked_at is not null then
        raise exception 'New invitations start as pending' using errcode = '42501';
      end if;
    else
      if old.status in ('accepted', 'revoked') then
        raise exception 'This invitation is closed. Send a new one instead.' using errcode = '42501';
      end if;
      if new.status = 'accepted' or new.accepted_by is distinct from old.accepted_by
         or new.accepted_at is distinct from old.accepted_at or new.membership_id is distinct from old.membership_id then
        raise exception 'Only the invited person can accept an invitation' using errcode = '42501';
      end if;
      if new.status = 'revoked' and old.status <> 'revoked' then
        new.revoked_by := actor;
        new.revoked_at := now();
      elsif new.revoked_by is distinct from old.revoked_by or new.revoked_at is distinct from old.revoked_at then
        raise exception 'Revocation details are set automatically' using errcode = '42501';
      end if;
      -- Re-opening an expired invitation (resend) requires a fresh link.
      if old.status = 'expired' and new.status = 'pending' and new.token_hash = old.token_hash then
        raise exception 'Resending needs a new link' using errcode = '42501';
      end if;
    end if;

    if new.status = 'pending' and (new.expires_at <= now() or new.expires_at > now() + interval '30 days') then
      raise exception 'Invitations must expire within 30 days' using errcode = '22023';
    end if;
  end if;

  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    -- Existing members (any status) are managed in the member list, not invited again.
    if exists (
      select 1 from public.organization_memberships m
      join public.user_profiles p on p.id = m.user_id
      where m.organization_id = new.organization_id and lower(p.email) = new.email
    ) then
      raise exception 'This person is already a member of the team' using errcode = '23505';
    end if;
    -- An older pending invitation that has run out no longer blocks a new one.
    update public.team_invitations
       set status = 'expired'
     where organization_id = new.organization_id and email = new.email
       and status = 'pending' and expires_at <= now() and id <> new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists team_invitations_rules on public.team_invitations;
create trigger team_invitations_rules before insert or update on public.team_invitations
  for each row execute function public.team_invitations_rules();

create or replace function public.audit_team_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  act text;
begin
  if tg_op = 'INSERT' then
    act := 'invite.created';
  elsif new.status = 'accepted' and old.status <> 'accepted' then
    act := 'invite.accepted';
  elsif new.status = 'revoked' and old.status <> 'revoked' then
    act := 'invite.revoked';
  elsif new.token_hash <> old.token_hash then
    act := 'invite.resent';
  else
    return new;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    new.organization_id,
    coalesce(auth.uid(), case when act = 'invite.accepted' then new.accepted_by end),
    act,
    'team_invitation',
    new.id,
    jsonb_build_object('email', new.email, 'role', new.role, 'membership_id', new.membership_id)
  );
  return new;
end;
$$;

drop trigger if exists team_invitations_audit on public.team_invitations;
create trigger team_invitations_audit after insert or update on public.team_invitations
  for each row execute function public.audit_team_invitation();

-- -----------------------------------------------------------------------------
-- Public side (called by the server with the secret key; never by browsers)
-- -----------------------------------------------------------------------------

-- What the invitation page shows. Status is "expired" once the time is up.
create or replace function public.get_team_invitation(p_token_hash text)
returns table (
  invitation_id     uuid,
  organization_name text,
  email             text,
  full_name         text,
  role              public.member_role,
  status            text,
  expires_at        timestamptz,
  role_enabled      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, o.name, i.email, i.full_name, i.role,
         case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
         i.expires_at,
         case i.role when 'staff' then o.staff_enabled when 'instructor' then o.instructors_enabled else true end
  from public.team_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = p_token_hash;
$$;

-- Turns a pending invitation into an active membership for p_user_id, whose
-- account email must match the invitation. Returns a result code instead of
-- raising, so an expired invitation is recorded as expired.
--   ok | already_member | not_found | used | revoked | expired | email_mismatch
create or replace function public.accept_team_invitation(p_token_hash text, p_user_id uuid, p_full_name text default null)
returns table (result text, organization_id uuid, membership_id uuid, role public.member_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.team_invitations;
  user_email text;
  mem public.organization_memberships;
  new_member uuid;
begin
  select * into inv from public.team_invitations i where i.token_hash = p_token_hash for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::public.member_role;
    return;
  end if;
  if inv.status <> 'pending' then
    return query select (case inv.status when 'accepted' then 'used' else inv.status end)::text, inv.organization_id, null::uuid, inv.role;
    return;
  end if;
  if inv.expires_at <= now() then
    update public.team_invitations set status = 'expired' where id = inv.id;
    return query select 'expired'::text, inv.organization_id, null::uuid, inv.role;
    return;
  end if;

  select lower(p.email) into user_email from public.user_profiles p where p.id = p_user_id;
  if user_email is null or user_email <> inv.email then
    return query select 'email_mismatch'::text, inv.organization_id, null::uuid, inv.role;
    return;
  end if;

  if nullif(btrim(coalesce(p_full_name, '')), '') is not null then
    update public.user_profiles set full_name = left(btrim(p_full_name), 120) where id = p_user_id;
  end if;

  select * into mem from public.organization_memberships m
   where m.organization_id = inv.organization_id and m.user_id = p_user_id;

  if found and mem.status <> 'invited' then
    -- Never reactivates a suspended member or changes an existing role.
    update public.team_invitations
       set status = 'accepted', accepted_by = p_user_id, accepted_at = now(), membership_id = mem.id
     where id = inv.id;
    return query select 'already_member'::text, inv.organization_id, mem.id, mem.role;
    return;
  elsif found then
    update public.organization_memberships set status = 'active', role = inv.role where id = mem.id;
    new_member := mem.id;
  else
    insert into public.organization_memberships (organization_id, user_id, role, status)
    values (inv.organization_id, p_user_id, inv.role, 'active')
    returning id into new_member;
  end if;

  update public.team_invitations
     set status = 'accepted', accepted_by = p_user_id, accepted_at = now(), membership_id = new_member
   where id = inv.id;

  return query select 'ok'::text, inv.organization_id, new_member, inv.role;
end;
$$;

-- -----------------------------------------------------------------------------
-- Per-member permission overrides: tighten who may change what, and audit it.
-- -----------------------------------------------------------------------------

create or replace function public.membership_overrides_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.organization_memberships;
  actor_role public.member_role;
begin
  if actor is null then
    return coalesce(new, old);
  end if;
  select * into target from public.organization_memberships m
   where m.id = coalesce(new.membership_id, old.membership_id);
  actor_role := (public.current_membership(target.organization_id)).role;
  if actor_role is distinct from 'owner' and target.role in ('owner', 'admin') then
    raise exception 'Only the owner can change an administrator''s permissions' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.allowed
     and not public.has_permission(target.organization_id, new.permission_key) then
    raise exception 'You cannot grant a permission you do not have' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists membership_overrides_rules on public.membership_permission_overrides;
create trigger membership_overrides_rules before insert or update or delete on public.membership_permission_overrides
  for each row execute function public.membership_overrides_rules();

create or replace function public.audit_membership_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.membership_permission_overrides := coalesce(new, old);
  org uuid;
begin
  select m.organization_id into org from public.organization_memberships m where m.id = rec.membership_id;
  if org is null then
    return rec; -- membership being deleted (cascade)
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    org, auth.uid(), 'member.permissions_changed', 'membership', rec.membership_id,
    jsonb_build_object('permission', rec.permission_key,
                       'allowed', case when tg_op = 'DELETE' then null else new.allowed end,
                       'reset_to_role_default', tg_op = 'DELETE')
  );
  return rec;
end;
$$;

drop trigger if exists membership_overrides_audit on public.membership_permission_overrides;
create trigger membership_overrides_audit after insert or update or delete on public.membership_permission_overrides
  for each row execute function public.audit_membership_override();

-- -----------------------------------------------------------------------------
-- "Team invitation" email template (editable; the app has a built-in copy if
-- it is deleted)
-- -----------------------------------------------------------------------------

create or replace function public.seed_team_invitation_template(org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_templates (organization_id, key, name, audience, subject, preheader, design)
  values (
    org, 'team_invitation', 'Team invitation (to a new team member)', 'team',
    '{{inviter_name}} invited you to join {{business_name}}',
    'Set your password to start using the {{business_name}} dashboard.',
    jsonb_build_object(
      'heading', 'You''re invited, {{invitee_name}}',
      'body', $body${{inviter_name}} has invited you to join {{business_name}} as {{invite_role}}.

Click the button below to choose your password and sign in. The link works once and expires on {{invite_expires}}.

If you were not expecting this invitation, you can ignore this email.$body$,
      'button_label', 'Accept invitation',
      'button_url', '{{invite_url}}',
      'footer_text', 'Sent by {{business_name}}. Please do not forward this email: the link gives access to the team dashboard.',
      'accent_color', '#0176d3'
    )
  )
  on conflict (organization_id, key) do nothing;
end;
$$;

create or replace function public.organizations_seed_team_invitation_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_team_invitation_template(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_seed_team_invitation_template on public.organizations;
create trigger organizations_seed_team_invitation_template after insert on public.organizations
  for each row execute function public.organizations_seed_team_invitation_template();

select public.seed_team_invitation_template(id) from public.organizations;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------

alter table public.team_invitations enable row level security;

drop policy if exists "member managers read invitations" on public.team_invitations;
create policy "member managers read invitations" on public.team_invitations for select to authenticated
  using (public.has_permission(organization_id, 'members.manage'));

drop policy if exists "member managers create invitations" on public.team_invitations;
create policy "member managers create invitations" on public.team_invitations for insert to authenticated
  with check (public.has_permission(organization_id, 'members.manage'));

drop policy if exists "member managers update invitations" on public.team_invitations;
create policy "member managers update invitations" on public.team_invitations for update to authenticated
  using (public.has_permission(organization_id, 'members.manage'))
  with check (public.has_permission(organization_id, 'members.manage'));

revoke all on public.team_invitations from anon, authenticated;
-- token_hash is write-only for app users.
grant select (id, organization_id, email, full_name, phone, role, status, expires_at, invited_by, accepted_by,
              accepted_at, revoked_by, revoked_at, membership_id, send_count, last_sent_at, email_status,
              email_error, created_at, updated_at)
  on public.team_invitations to authenticated;
grant insert (organization_id, email, full_name, phone, role, token_hash, expires_at)
  on public.team_invitations to authenticated;
grant update (status, token_hash, expires_at, send_count, last_sent_at, email_status, email_error)
  on public.team_invitations to authenticated;
grant all on public.team_invitations to service_role;

-- Function grants (one by one; see the conventions in the first migration).
revoke execute on function public.team_invitations_rules() from public, anon, authenticated;
revoke execute on function public.audit_team_invitation() from public, anon, authenticated;
revoke execute on function public.membership_overrides_rules() from public, anon, authenticated;
revoke execute on function public.audit_membership_override() from public, anon, authenticated;
revoke execute on function public.organizations_seed_team_invitation_template() from public, anon, authenticated;
revoke execute on function public.seed_team_invitation_template(uuid) from public, anon, authenticated;
revoke execute on function public.get_team_invitation(text) from public, anon, authenticated;
revoke execute on function public.accept_team_invitation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.seed_team_invitation_template(uuid) to service_role;
grant execute on function public.get_team_invitation(text) to service_role;
grant execute on function public.accept_team_invitation(text, uuid, text) to service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000009_demos_resources.sql

-- =============================================================================
-- Adrenaline Rush: Demos & Resources
--   * resources          demo videos, recordings, curriculum documents, links
--   * resource_courses   which course(s) a resource belongs to (optional)
--   * share_templates    editable WhatsApp / email message templates
--   * sharing_settings   per-organization sharing options (WhatsApp country code)
--   * resource_shares    every share, with an honest status (append-only)
-- Public visitors read a shareable resource only through get_public_resource().
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Resources
-- -----------------------------------------------------------------------------

create table if not exists public.resources (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  title                text not null check (char_length(btrim(title)) between 2 and 160),
  -- Public link /r/<slug> (only served while the resource is shareable and active).
  slug                 text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  type                 text not null default 'link' check (type in (
                         'demo_video', 'recorded_demo', 'demo_booking', 'sample_class', 'curriculum',
                         'presentation', 'project_example', 'documentation', 'github_repo', 'assignment',
                         'recording', 'link')),
  description          text check (description is null or char_length(description) <= 4000),
  url                  text not null check (char_length(url) <= 1000 and url ~* '^https://[^\s<>"]+$'),
  thumbnail_url        text check (thumbnail_url is null or (char_length(thumbnail_url) <= 1000 and thumbnail_url ~* '^https://[^\s<>"]+$')),
  -- internal: team only, never shared or public. shareable: can be sent to candidates and has a public page.
  visibility           text not null default 'internal' check (visibility in ('internal', 'shareable')),
  is_active            boolean not null default true,
  access_instructions  text check (access_instructions is null or char_length(access_instructions) <= 1000),
  -- After this date the public page and sharing stop working.
  expires_on           date,
  created_by           uuid references public.user_profiles (id) on delete set null,
  updated_by           uuid references public.user_profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, slug)
);
create index if not exists resources_org_idx on public.resources (organization_id, is_active, updated_at desc);

drop trigger if exists resources_updated_at on public.resources;
create trigger resources_updated_at before update on public.resources
  for each row execute function public.set_updated_at();

create table if not exists public.resource_courses (
  resource_id  uuid not null references public.resources (id) on delete cascade,
  course_id    uuid not null references public.courses (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (resource_id, course_id)
);
create index if not exists resource_courses_course_idx on public.resource_courses (course_id);

create or replace function public.resource_org(rid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.resources where id = rid;
$$;

-- A resource's courses must belong to the same organization.
create or replace function public.resource_courses_check_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.resource_org(new.resource_id) is distinct from public.course_org(new.course_id) then
    raise exception 'Course belongs to another organization' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists resource_courses_check_org on public.resource_courses;
create trigger resource_courses_check_org before insert or update on public.resource_courses
  for each row execute function public.resource_courses_check_org();

-- True while a resource may be shared and shown on its public page.
create or replace function public.resource_is_shareable(r public.resources)
returns boolean
language sql
stable
set search_path = ''
as $$
  select r.visibility = 'shareable' and r.is_active and (r.expires_on is null or r.expires_on >= current_date);
$$;

-- -----------------------------------------------------------------------------
-- Message templates and settings
-- -----------------------------------------------------------------------------

create table if not exists public.share_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Stable key for seeded templates; null for templates created in the app.
  key              text check (key is null or key ~ '^[a-z][a-z0-9_]{0,59}$'),
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  -- Which share method the template is written for ("any" fits both).
  channel          text not null default 'any' check (channel in ('any', 'whatsapp', 'email')),
  subject          text check (subject is null or char_length(subject) <= 200),
  body             text not null check (char_length(btrim(body)) between 1 and 4000),
  position         integer not null default 0,
  created_by       uuid references public.user_profiles (id) on delete set null,
  updated_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, key)
);
create index if not exists share_templates_org_idx on public.share_templates (organization_id, position, name);

drop trigger if exists share_templates_updated_at on public.share_templates;
create trigger share_templates_updated_at before update on public.share_templates
  for each row execute function public.set_updated_at();

create table if not exists public.sharing_settings (
  organization_id        uuid primary key references public.organizations (id) on delete cascade,
  -- Added to phone numbers saved without a country code when opening WhatsApp (91 = India).
  whatsapp_country_code  text not null default '91' check (whatsapp_country_code ~ '^[1-9][0-9]{0,3}$'),
  updated_by             uuid references public.user_profiles (id) on delete set null,
  updated_at             timestamptz not null default now()
);

drop trigger if exists sharing_settings_updated_at on public.sharing_settings;
create trigger sharing_settings_updated_at before update on public.sharing_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Share log. Status is honest: copying or opening WhatsApp is never "sent";
-- only an email accepted by the provider is "sent".
-- -----------------------------------------------------------------------------

create table if not exists public.resource_shares (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Null when shared without a candidate (for example a link copied for a group post).
  candidate_id     uuid references public.candidates (id) on delete cascade,
  resource_ids     uuid[] not null check (cardinality(resource_ids) between 1 and 20),
  -- Snapshot filled by the database, so history survives renames and deletions.
  resource_titles  text[] not null default '{}',
  method           text not null check (method in ('copy_message', 'copy_link', 'whatsapp', 'email')),
  status           text not null check (status in ('copied', 'opened', 'sent', 'failed', 'not_sent')),
  template_id      uuid references public.share_templates (id) on delete set null,
  template_name    text check (template_name is null or char_length(template_name) <= 120),
  recipient        text check (recipient is null or char_length(recipient) <= 254),
  message          text check (message is null or char_length(message) <= 6000),
  error            text check (error is null or char_length(error) <= 1000),
  -- Groups the rows of one bulk share.
  batch_id         uuid,
  shared_by        uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (
    (method in ('copy_message', 'copy_link') and status = 'copied')
    or (method = 'whatsapp' and status = 'opened')
    or (method = 'email' and status in ('sent', 'failed', 'not_sent'))
  )
);
create index if not exists resource_shares_org_idx on public.resource_shares (organization_id, created_at desc);
create index if not exists resource_shares_candidate_idx on public.resource_shares (candidate_id, created_at desc);
create index if not exists resource_shares_resources_idx on public.resource_shares using gin (resource_ids);

-- Validates references and fills the snapshots. Only active, shareable resources
-- of the share's organization can be shared.
create or replace function public.resource_shares_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_count integer;
begin
  select count(*), coalesce(array_agg(r.title order by array_position(new.resource_ids, r.id)), '{}')
    into found_count, new.resource_titles
    from public.resources r
   where r.id = any (new.resource_ids)
     and r.organization_id = new.organization_id
     and public.resource_is_shareable(r);
  if found_count <> cardinality(new.resource_ids)
     or (select count(distinct x) from unnest(new.resource_ids) x) <> cardinality(new.resource_ids) then
    raise exception 'Only active, shareable resources of this organization can be shared' using errcode = '23514';
  end if;
  if new.candidate_id is not null and not exists (
    select 1 from public.candidates c where c.id = new.candidate_id and c.organization_id = new.organization_id
  ) then
    raise exception 'Candidate belongs to another organization' using errcode = '23503';
  end if;
  new.template_name := null;
  if new.template_id is not null then
    select t.name into new.template_name from public.share_templates t
     where t.id = new.template_id and t.organization_id = new.organization_id;
    if new.template_name is null then
      raise exception 'Template belongs to another organization' using errcode = '23503';
    end if;
  end if;
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists resource_shares_prepare on public.resource_shares;
create trigger resource_shares_prepare before insert on public.resource_shares
  for each row execute function public.resource_shares_prepare();

-- Every share with a candidate lands on the candidate's timeline.
create or replace function public.resource_shares_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  titles text := array_to_string(new.resource_titles, ', ');
  summary text;
begin
  if new.candidate_id is null then
    return new;
  end if;
  summary := case
    when new.method = 'whatsapp' then 'WhatsApp opened to share: '
    when new.method = 'copy_message' then 'Message copied to share: '
    when new.method = 'copy_link' then 'Link copied to share: '
    when new.status = 'sent' then 'Emailed: '
    when new.status = 'failed' then 'Email failed: '
    else 'Email not sent: '
  end || titles;
  insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
  values (new.organization_id, new.candidate_id, 'resource_shared', left(summary, 240),
          jsonb_build_object('share_id', new.id, 'method', new.method, 'status', new.status,
                             'resource_ids', to_jsonb(new.resource_ids), 'template_id', new.template_id),
          new.shared_by);
  return new;
end;
$$;
drop trigger if exists resource_shares_activity on public.resource_shares;
create trigger resource_shares_activity after insert on public.resource_shares
  for each row execute function public.resource_shares_activity();

-- Times each resource was shared (only shares the caller may see are counted).
create or replace function public.resource_share_counts(p_org uuid)
returns table (resource_id uuid, shares bigint, last_shared_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select r_id, count(*), max(s.created_at)
    from public.resource_shares s
    cross join lateral unnest(s.resource_ids) as r_id
   where s.organization_id = p_org
   group by r_id;
$$;

-- Share emails are logged in email_log next to automation and test emails.
alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check check (kind in ('automation', 'test', 'share'));

-- -----------------------------------------------------------------------------
-- Defaults for every organization: settings and three message templates.
-- Seeded once (when the settings row is first created), so templates the
-- owner deletes are not recreated by re-running setup.sql.
-- -----------------------------------------------------------------------------

create or replace function public.seed_sharing_defaults(org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  created uuid;
begin
  insert into public.sharing_settings (organization_id) values (org)
  on conflict (organization_id) do nothing
  returning organization_id into created;
  if created is null then
    return;
  end if;

  insert into public.share_templates (organization_id, key, name, channel, subject, body, position) values
  (org, 'demo_whatsapp', 'Demo link (WhatsApp)', 'whatsapp', null,
$body$Hi {{first_name}},

Thanks for your interest in {{course_title}}! Here is the demo for you:
{{resource_links}}

Course details and curriculum: {{course_url}}

Reply here if you have any questions.
{{sender_name}}, {{business_name}}$body$, 10),
  (org, 'resources_email', 'Demo and resources (email)', 'email', 'Your {{course_title}} demo and resources',
$body$Hi {{first_name}},

Thank you for your interest in {{course_title}} at {{business_name}}.

Here are the resources we talked about:
{{resource_links}}

You can review the curriculum and enrollment details here: {{course_url}}

Let me know if you have any questions.

Regards,
{{sender_name}}
{{business_name}}$body$, 20),
  (org, 'after_demo_follow_up', 'Follow-up after the demo', 'any', 'Materials from your {{course_title}} demo',
$body$Hi {{first_name}}, thank you for attending the {{course_title}} demo.

As promised, here are the recordings and materials:
{{resource_links}}

When you are ready to enroll, everything is on the course page: {{course_url}}$body$, 30)
  on conflict (organization_id, key) do nothing;
end;
$$;

create or replace function public.organizations_seed_sharing_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_sharing_defaults(new.id);
  return new;
end;
$$;
drop trigger if exists organizations_seed_sharing_defaults on public.organizations;
create trigger organizations_seed_sharing_defaults after insert on public.organizations
  for each row execute function public.organizations_seed_sharing_defaults();

select public.seed_sharing_defaults(id) from public.organizations;

-- -----------------------------------------------------------------------------
-- Public read API: one shareable, active, unexpired resource of the business,
-- with its published courses. Nothing else is exposed.
-- -----------------------------------------------------------------------------

create or replace function public.get_public_resource(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slug', r.slug,
    'title', r.title,
    'type', r.type,
    'description', r.description,
    'url', r.url,
    'thumbnail_url', r.thumbnail_url,
    'access_instructions', r.access_instructions,
    'organization_name', (select o.name from public.organizations o where o.id = r.organization_id),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
          'slug', c.slug, 'title', c.title, 'short_description', c.short_description,
          'registration_open', public.course_is_open(c),
          'registration_mode', c.registration_mode, 'cta_label', c.cta_label
        ) order by c.title)
        from public.resource_courses rc
        join public.courses c on c.id = rc.course_id
       where rc.resource_id = r.id and c.status = 'published'), '[]'::jsonb)
  )
  from public.resources r
  where r.organization_id = public.primary_organization_id()
    and r.slug = p_slug
    and public.resource_is_shareable(r);
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.resources        enable row level security;
alter table public.resource_courses enable row level security;
alter table public.share_templates  enable row level security;
alter table public.sharing_settings enable row level security;
alter table public.resource_shares  enable row level security;

drop policy if exists "resource viewers read resources" on public.resources;
create policy "resource viewers read resources" on public.resources for select to authenticated
  using (public.has_permission(organization_id, 'resources.view'));
drop policy if exists "resource managers write resources" on public.resources;
create policy "resource managers write resources" on public.resources for all to authenticated
  using (public.has_permission(organization_id, 'resources.manage'))
  with check (public.has_permission(organization_id, 'resources.manage'));

drop policy if exists "resource viewers read resource courses" on public.resource_courses;
create policy "resource viewers read resource courses" on public.resource_courses for select to authenticated
  using (public.has_permission(public.resource_org(resource_id), 'resources.view'));
drop policy if exists "resource managers write resource courses" on public.resource_courses;
create policy "resource managers write resource courses" on public.resource_courses for all to authenticated
  using (public.has_permission(public.resource_org(resource_id), 'resources.manage'))
  with check (public.has_permission(public.resource_org(resource_id), 'resources.manage'));

drop policy if exists "resource viewers read share templates" on public.share_templates;
create policy "resource viewers read share templates" on public.share_templates for select to authenticated
  using (public.has_permission(organization_id, 'resources.view'));
drop policy if exists "resource managers write share templates" on public.share_templates;
create policy "resource managers write share templates" on public.share_templates for all to authenticated
  using (public.has_permission(organization_id, 'resources.manage'))
  with check (public.has_permission(organization_id, 'resources.manage'));

drop policy if exists "members read sharing settings" on public.sharing_settings;
create policy "members read sharing settings" on public.sharing_settings for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists "settings managers update sharing settings" on public.sharing_settings;
create policy "settings managers update sharing settings" on public.sharing_settings for update to authenticated
  using (public.has_permission(organization_id, 'settings.manage') or public.has_permission(organization_id, 'integrations.manage'))
  with check (public.has_permission(organization_id, 'settings.manage') or public.has_permission(organization_id, 'integrations.manage'));

-- Shares hold a phone number or address: rows about a candidate are visible
-- only to people who may see that candidate. Append-only for app users.
drop policy if exists "resource viewers read shares" on public.resource_shares;
create policy "resource viewers read shares" on public.resource_shares for select to authenticated
  using (public.has_permission(organization_id, 'resources.view')
         and (candidate_id is null or public.can_view_candidate_id(candidate_id)));
drop policy if exists "sharers record shares" on public.resource_shares;
create policy "sharers record shares" on public.resource_shares for insert to authenticated
  with check (public.has_permission(organization_id, 'resources.share')
              and shared_by = (select auth.uid())
              and (candidate_id is null or public.can_view_candidate_id(candidate_id)));

-- -----------------------------------------------------------------------------
-- Table grants (Supabase's defaults grant everything to anon/authenticated)
-- -----------------------------------------------------------------------------

revoke all on public.resources, public.resource_courses, public.share_templates,
  public.sharing_settings, public.resource_shares
  from anon, authenticated;

grant select, insert, update, delete on public.resources, public.resource_courses, public.share_templates to authenticated;
grant select on public.sharing_settings to authenticated;
grant update (whatsapp_country_code, updated_by) on public.sharing_settings to authenticated;
grant select on public.resource_shares to authenticated;
grant insert (id, organization_id, candidate_id, resource_ids, method, status, template_id, recipient, message, error, batch_id, shared_by)
  on public.resource_shares to authenticated;

grant all on public.resources, public.resource_courses, public.share_templates,
  public.sharing_settings, public.resource_shares to service_role;

-- -----------------------------------------------------------------------------
-- Function grants (each function created here; no blanket revoke)
-- -----------------------------------------------------------------------------

revoke execute on function public.resource_org(uuid) from public, anon, authenticated;
grant execute on function public.resource_org(uuid) to authenticated, service_role;

revoke execute on function public.resource_is_shareable(public.resources) from public, anon, authenticated;
grant execute on function public.resource_is_shareable(public.resources) to authenticated, service_role;

revoke execute on function public.resource_share_counts(uuid) from public, anon, authenticated;
grant execute on function public.resource_share_counts(uuid) to authenticated, service_role;

revoke execute on function public.get_public_resource(text) from public, anon, authenticated;
grant execute on function public.get_public_resource(text) to anon, authenticated, service_role;

revoke execute on function public.seed_sharing_defaults(uuid) from public, anon, authenticated;
grant execute on function public.seed_sharing_defaults(uuid) to service_role;

-- Trigger functions: never called directly.
revoke execute on function public.resource_courses_check_org() from public, anon, authenticated;
revoke execute on function public.resource_shares_prepare() from public, anon, authenticated;
revoke execute on function public.resource_shares_activity() from public, anon, authenticated;
revoke execute on function public.organizations_seed_sharing_defaults() from public, anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> 20261014000010_batches_sessions.sql

-- =============================================================================
-- Adrenaline Rush: batches, enrollments, class sessions, attendance and the
-- optional Google Calendar / Meet connection (roadmap phase 5). Safe to re-run.
--
-- Visibility rules
--   * batches.manage sees every batch; batches.view sees every batch EXCEPT for
--     the instructor role, which sees only the batches it teaches.
--   * Sessions follow the same idea with sessions.view / sessions.manage.
--   * Enrollments are visible to whoever can see the candidate (CRM rules) or
--     the batch. Names on rosters come from get_batch_roster / get_session_people
--     so instructors can mark attendance without CRM access.
--   * Capacity, duplicate enrollments and attendance rules are enforced by
--     triggers, so they hold for every client, including concurrent ones.
--   * Google OAuth tokens are encrypted by the app and never readable through
--     the API: authenticated users get column grants without the token columns.
-- =============================================================================

do $$ begin
  create type public.batch_status as enum ('planned', 'open', 'full', 'running', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.enrollment_status as enum ('pending', 'active', 'on_hold', 'completed', 'dropped', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.session_status as enum ('scheduled', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.batches (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  course_id            uuid not null references public.courses (id) on delete restrict,
  name                 text not null check (char_length(btrim(name)) between 2 and 120),
  code                 text check (code is null or code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$'),
  start_date           date,
  end_date             date,
  timezone             text not null default 'Asia/Kolkata',
  -- 0 = Sunday ... 6 = Saturday (same as JavaScript's getDay()).
  class_days           smallint[] not null default '{}' check (class_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  start_time           time,
  end_time             time,
  schedule_note        text check (schedule_note is null or char_length(schedule_note) <= 200),
  capacity             integer check (capacity is null or capacity between 1 and 10000),
  delivery_mode        public.delivery_mode not null default 'online',
  instructor_id        uuid references public.user_profiles (id) on delete set null,
  default_meeting_url  text check (default_meeting_url is null or (default_meeting_url ~* '^https://' and char_length(default_meeting_url) <= 500)),
  status               public.batch_status not null default 'planned',
  notes                text check (notes is null or char_length(notes) <= 4000),
  created_by           uuid references public.user_profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check ((start_time is null) = (end_time is null)),
  check (end_time is null or end_time > start_time)
);
create index if not exists batches_org_status_idx on public.batches (organization_id, status, start_date);
create index if not exists batches_course_idx on public.batches (course_id);
create index if not exists batches_instructor_idx on public.batches (instructor_id);
create unique index if not exists batches_code_key on public.batches (organization_id, lower(code)) where code is not null;

-- A candidate's place on a course (and usually a batch). Finance records
-- reference enrollments.id; fees deliberately live outside this table.
create table if not exists public.enrollments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  candidate_id       uuid not null references public.candidates (id) on delete cascade,
  batch_id           uuid references public.batches (id) on delete restrict,
  course_id          uuid not null references public.courses (id) on delete restrict,
  status             public.enrollment_status not null default 'active',
  enrolled_at        timestamptz not null default now(),
  status_changed_at  timestamptz not null default now(),
  notes              text check (notes is null or char_length(notes) <= 2000),
  created_by         uuid references public.user_profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists enrollments_batch_idx on public.enrollments (batch_id, status);
create index if not exists enrollments_candidate_idx on public.enrollments (candidate_id, enrolled_at desc);
create index if not exists enrollments_org_idx on public.enrollments (organization_id, enrolled_at desc);
-- One live enrollment per candidate per batch (or per course when there is no batch).
create unique index if not exists enrollments_one_per_batch on public.enrollments (candidate_id, batch_id)
  where batch_id is not null and status not in ('dropped', 'cancelled');
create unique index if not exists enrollments_one_per_course_without_batch on public.enrollments (candidate_id, course_id)
  where batch_id is null and status not in ('dropped', 'cancelled');

create table if not exists public.class_sessions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  kind                  text not null default 'class' check (kind in ('class', 'demo')),
  batch_id              uuid references public.batches (id) on delete restrict,
  course_id             uuid not null references public.courses (id) on delete restrict,
  title                 text not null check (char_length(btrim(title)) between 1 and 200),
  description           text check (description is null or char_length(description) <= 4000),
  prep_notes            text check (prep_notes is null or char_length(prep_notes) <= 4000),
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  timezone              text not null default 'Asia/Kolkata',
  instructor_id         uuid references public.user_profiles (id) on delete set null,
  status                public.session_status not null default 'scheduled',
  meeting_url           text check (meeting_url is null or (meeting_url ~* '^https://' and char_length(meeting_url) <= 500)),
  -- 'manual' = pasted by staff, 'google' = created through Google Calendar.
  meeting_source        text check (meeting_source is null or meeting_source in ('manual', 'google')),
  recording_url         text check (recording_url is null or (recording_url ~* '^https://' and char_length(recording_url) <= 500)),
  notes                 text check (notes is null or char_length(notes) <= 4000),
  google_add_attendees  boolean not null default false,
  google_event_id       text check (google_event_id is null or google_event_id ~ '^[a-v0-9]{5,1024}$'),
  google_sync_status    text not null default 'none' check (google_sync_status in ('none', 'synced', 'failed')),
  google_sync_error     text check (google_sync_error is null or char_length(google_sync_error) <= 500),
  google_synced_at      timestamptz,
  cancelled_at          timestamptz,
  created_by            uuid references public.user_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  check ((kind = 'class') = (batch_id is not null))
);
create index if not exists class_sessions_org_time_idx on public.class_sessions (organization_id, starts_at);
create index if not exists class_sessions_batch_idx on public.class_sessions (batch_id, starts_at);
create index if not exists class_sessions_course_idx on public.class_sessions (course_id, starts_at);
-- Generating a schedule twice never creates the same class twice.
create unique index if not exists class_sessions_batch_start_key on public.class_sessions (batch_id, starts_at)
  where batch_id is not null and status <> 'cancelled';

-- Invited people for demo sessions (class sessions use the batch roster).
create table if not exists public.session_attendees (
  session_id       uuid not null references public.class_sessions (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  added_by         uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  primary key (session_id, candidate_id)
);
create index if not exists session_attendees_candidate_idx on public.session_attendees (candidate_id);

create table if not exists public.attendance_records (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  session_id       uuid not null references public.class_sessions (id) on delete cascade,
  candidate_id     uuid not null references public.candidates (id) on delete cascade,
  enrollment_id    uuid references public.enrollments (id) on delete set null,
  status           public.attendance_status not null,
  note             text check (note is null or char_length(note) <= 500),
  recorded_by      uuid references public.user_profiles (id) on delete set null,
  recorded_at      timestamptz not null default now(),
  unique (session_id, candidate_id)
);
create index if not exists attendance_records_candidate_idx on public.attendance_records (candidate_id);
create index if not exists attendance_records_enrollment_idx on public.attendance_records (enrollment_id);

-- One Google connection per business. Token columns hold AES-256-GCM
-- ciphertext produced by the app; they are never granted to API roles.
create table if not exists public.google_integrations (
  organization_id          uuid primary key references public.organizations (id) on delete cascade,
  status                   text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  calendar_id              text not null default 'primary' check (char_length(calendar_id) between 1 and 255),
  refresh_token_encrypted  text,
  access_token_encrypted   text,
  access_token_expires_at  timestamptz,
  scopes                   text,
  connected_by             uuid references public.user_profiles (id) on delete set null,
  connected_at             timestamptz,
  last_error               text check (last_error is null or char_length(last_error) <= 500),
  last_error_at            timestamptz,
  updated_at               timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Authorization helpers
-- -----------------------------------------------------------------------------

create or replace function public.can_view_batch(org uuid, batch_instructor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(org, 'batches.manage')
      or (public.has_permission(org, 'batches.view')
          and ((public.current_membership(org)).role is distinct from 'instructor'
               or batch_instructor = (select auth.uid())));
$$;

create or replace function public.can_view_batch_id(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.batches b
    where b.id = bid and public.can_view_batch(b.organization_id, b.instructor_id)
  );
$$;

create or replace function public.can_view_session(org uuid, session_batch uuid, session_instructor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_permission(org, 'sessions.manage')
      or (public.has_permission(org, 'sessions.view')
          and ((public.current_membership(org)).role is distinct from 'instructor'
               or session_instructor = (select auth.uid())
               or exists (select 1 from public.batches b
                          where b.id = session_batch and b.instructor_id = (select auth.uid()))));
$$;

create or replace function public.can_view_session_id(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_sessions s
    where s.id = sid and public.can_view_session(s.organization_id, s.batch_id, s.instructor_id)
  );
$$;

-- Attendance may be recorded by attendance.record holders for sessions they can see.
create or replace function public.can_record_attendance(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.class_sessions s
    where s.id = sid
      and public.has_permission(s.organization_id, 'attendance.record')
      and public.can_view_session(s.organization_id, s.batch_id, s.instructor_id)
  );
$$;

create or replace function public.is_active_member(org uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = uid and m.status = 'active'
  );
$$;

-- -----------------------------------------------------------------------------
-- Triggers: batches
-- -----------------------------------------------------------------------------

drop trigger if exists batches_updated_at on public.batches;
create trigger batches_updated_at before update on public.batches
  for each row execute function public.set_updated_at();

create or replace function public.batches_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'Batches cannot move between organizations' using errcode = '42501';
  end if;
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'Invalid time zone: %', new.timezone using errcode = '22023';
  end if;
  if not exists (select 1 from public.courses c where c.id = new.course_id and c.organization_id = new.organization_id) then
    raise exception 'Course belongs to another organization' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.course_id <> old.course_id
     and exists (select 1 from public.enrollments e where e.batch_id = new.id) then
    raise exception 'The course of a batch with enrollments cannot be changed' using errcode = '23514';
  end if;
  if new.instructor_id is not null and not public.is_active_member(new.organization_id, new.instructor_id) then
    raise exception 'The instructor must be an active team member' using errcode = '23503';
  end if;
  select array(select distinct d from unnest(new.class_days) d order by d) into new.class_days;
  return new;
end;
$$;
drop trigger if exists batches_validate on public.batches;
create trigger batches_validate before insert or update on public.batches
  for each row execute function public.batches_validate();

create or replace function public.batches_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.batches := coalesce(new, old);
  changed jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at');
    if changed = '{}'::jsonb then
      return new;
    end if;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (rec.organization_id, auth.uid(),
          case tg_op when 'INSERT' then 'batch.created' when 'UPDATE' then 'batch.updated' else 'batch.deleted' end,
          'batch', rec.id,
          case when tg_op = 'UPDATE' then jsonb_build_object('changed', changed)
               else jsonb_build_object('name', rec.name, 'course_id', rec.course_id) end);
  return rec;
end;
$$;
drop trigger if exists batches_audit on public.batches;
create trigger batches_audit after insert or update or delete on public.batches
  for each row execute function public.batches_audit();

-- -----------------------------------------------------------------------------
-- Triggers: enrollments (same org, capacity with a row lock, duplicates)
-- -----------------------------------------------------------------------------

drop trigger if exists enrollments_updated_at on public.enrollments;
create trigger enrollments_updated_at before update on public.enrollments
  for each row execute function public.set_updated_at();

-- Statuses that hold a seat in a batch.
create or replace function public.enrollment_holds_seat(s public.enrollment_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s in ('pending', 'active', 'on_hold', 'completed');
$$;

create or replace function public.enrollments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.batches;
  taken integer;
  entering boolean;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.candidate_id <> old.candidate_id then
      raise exception 'An enrollment cannot change its organization or candidate' using errcode = '42501';
    end if;
    if new.batch_id is null and old.batch_id is not null then
      raise exception 'An enrollment cannot be removed from its batch; transfer or drop it instead' using errcode = '23514';
    end if;
  end if;

  if not exists (select 1 from public.candidates c where c.id = new.candidate_id and c.organization_id = new.organization_id) then
    raise exception 'Candidate not found' using errcode = '23503';
  end if;

  if new.batch_id is not null then
    -- Lock the batch row: concurrent enrollments into the same batch queue up
    -- here, so the seat count below always sees the previous one.
    select * into b from public.batches where id = new.batch_id for update;
    if b.id is null or b.organization_id <> new.organization_id then
      raise exception 'Batch not found' using errcode = '23503';
    end if;
    if tg_op = 'UPDATE' and new.batch_id is distinct from old.batch_id and b.course_id <> old.course_id then
      raise exception 'Students can only be transferred to another batch of the same course' using errcode = 'ARCRS';
    end if;
    new.course_id := b.course_id;

    entering := public.enrollment_holds_seat(new.status)
      and (tg_op = 'INSERT' or new.batch_id is distinct from old.batch_id or not public.enrollment_holds_seat(old.status));

    if entering then
      if b.status in ('completed', 'cancelled') then
        raise exception 'This batch is %, so no one can be added to it', b.status using errcode = 'ARBST';
      end if;
      if exists (
        select 1 from public.enrollments e
        where e.batch_id = new.batch_id and e.candidate_id = new.candidate_id and e.id <> new.id
          and e.status not in ('dropped', 'cancelled')
      ) then
        raise exception 'This candidate is already enrolled in this batch' using errcode = 'ARDUP';
      end if;
      if b.capacity is not null then
        select count(*) into taken from public.enrollments e
        where e.batch_id = new.batch_id and e.id <> new.id and public.enrollment_holds_seat(e.status);
        if taken >= b.capacity then
          raise exception 'This batch is full (% of % seats taken)', taken, b.capacity using errcode = 'ARCAP';
        end if;
      end if;
    end if;
  else
    if not exists (select 1 from public.courses c where c.id = new.course_id and c.organization_id = new.organization_id) then
      raise exception 'Course not found' using errcode = '23503';
    end if;
    if tg_op = 'INSERT' and exists (
      select 1 from public.enrollments e
      where e.batch_id is null and e.course_id = new.course_id and e.candidate_id = new.candidate_id
        and e.status not in ('dropped', 'cancelled')
    ) then
      raise exception 'This candidate is already enrolled in this course' using errcode = 'ARDUP';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists enrollments_before_write on public.enrollments;
create trigger enrollments_before_write before insert or update on public.enrollments
  for each row execute function public.enrollments_before_write();

-- Keeps "open" and "full" in step with the seat count.
create or replace function public.refresh_batch_fullness(bid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.batches;
  taken integer;
begin
  select * into b from public.batches where id = bid;
  if b.id is null or b.capacity is null or b.status not in ('open', 'full') then
    return;
  end if;
  select count(*) into taken from public.enrollments e where e.batch_id = bid and public.enrollment_holds_seat(e.status);
  if taken >= b.capacity and b.status = 'open' then
    update public.batches set status = 'full' where id = bid;
  elsif taken < b.capacity and b.status = 'full' then
    update public.batches set status = 'open' where id = bid;
  end if;
end;
$$;

create or replace function public.enrollments_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text;
  old_label text;
  won_status uuid;
  labels constant jsonb := '{"pending":"Pending","active":"Active","on_hold":"On hold","completed":"Completed","dropped":"Dropped","cancelled":"Cancelled"}';
begin
  select coalesce(b.name || ' · ', '') || c.title into label
  from public.courses c left join public.batches b on b.id = new.batch_id
  where c.id = new.course_id;

  if tg_op = 'INSERT' then
    insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
    values (new.organization_id, new.candidate_id, 'enrolled', 'Enrolled in ' || coalesce(label, 'a course'),
            jsonb_build_object('enrollment_id', new.id, 'batch_id', new.batch_id, 'course_id', new.course_id, 'status', new.status), auth.uid());
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
    values (new.organization_id, auth.uid(), 'enrollment.created', 'enrollment', new.id,
            jsonb_build_object('candidate_id', new.candidate_id, 'batch_id', new.batch_id, 'status', new.status));
  else
    if new.batch_id is distinct from old.batch_id then
      select b.name into old_label from public.batches b where b.id = old.batch_id;
      insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
      values (new.organization_id, new.candidate_id, 'enrollment_transferred',
              format('Transferred from %s to %s', coalesce(old_label, '—'), coalesce(label, '—')),
              jsonb_build_object('enrollment_id', new.id, 'from_batch_id', old.batch_id, 'to_batch_id', new.batch_id), auth.uid());
      perform public.refresh_batch_fullness(old.batch_id);
    end if;
    if new.status is distinct from old.status then
      insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
      values (new.organization_id, new.candidate_id, 'enrollment_status_changed',
              format('Enrollment in %s: %s → %s', coalesce(label, 'a course'), labels ->> old.status::text, labels ->> new.status::text),
              jsonb_build_object('enrollment_id', new.id, 'from', old.status, 'to', new.status), auth.uid());
    end if;
    if new.batch_id is distinct from old.batch_id or new.status is distinct from old.status or new.notes is distinct from old.notes then
      insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
      values (new.organization_id, auth.uid(), 'enrollment.updated', 'enrollment', new.id,
              jsonb_build_object('from_status', old.status, 'to_status', new.status, 'from_batch_id', old.batch_id, 'to_batch_id', new.batch_id));
    end if;
  end if;

  -- Becoming an active student moves the lead to the "Enrolled" status (or the
  -- first "won" status if the owner renamed it), when one exists.
  if new.status in ('active', 'completed') and (tg_op = 'INSERT' or old.status not in ('active', 'completed')) then
    select s.id into won_status from public.lead_statuses s
    where s.organization_id = new.organization_id and (s.key = 'enrolled' or s.is_won)
    order by (s.key = 'enrolled') desc, s.position
    limit 1;
    if won_status is not null then
      update public.candidates set lead_status_id = won_status
      where id = new.candidate_id and lead_status_id is distinct from won_status;
    end if;
  end if;

  if new.batch_id is not null then
    perform public.refresh_batch_fullness(new.batch_id);
  end if;
  return new;
end;
$$;
drop trigger if exists enrollments_after_write on public.enrollments;
create trigger enrollments_after_write after insert or update on public.enrollments
  for each row execute function public.enrollments_after_write();

-- -----------------------------------------------------------------------------
-- Triggers: sessions, demo invitees, attendance
-- -----------------------------------------------------------------------------

drop trigger if exists class_sessions_updated_at on public.class_sessions;
create trigger class_sessions_updated_at before update on public.class_sessions
  for each row execute function public.set_updated_at();

create or replace function public.class_sessions_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.batches;
begin
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.kind <> old.kind) then
    raise exception 'A session cannot change its organization or kind' using errcode = '42501';
  end if;
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'Invalid time zone: %', new.timezone using errcode = '22023';
  end if;
  if new.batch_id is not null then
    select * into b from public.batches where id = new.batch_id;
    if b.id is null or b.organization_id <> new.organization_id then
      raise exception 'Batch not found' using errcode = '23503';
    end if;
    new.course_id := b.course_id;
  elsif not exists (select 1 from public.courses c where c.id = new.course_id and c.organization_id = new.organization_id) then
    raise exception 'Course not found' using errcode = '23503';
  end if;
  if new.instructor_id is not null and not public.is_active_member(new.organization_id, new.instructor_id) then
    raise exception 'The instructor must be an active team member' using errcode = '23503';
  end if;
  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status <> 'cancelled') then
    new.cancelled_at := now();
  elsif new.status <> 'cancelled' then
    new.cancelled_at := null;
  end if;
  -- 'google' without a URL means "Meet requested, link not created yet".
  if new.meeting_url is null and new.meeting_source = 'manual' then
    new.meeting_source := null;
  elsif new.meeting_url is not null and new.meeting_source is null then
    new.meeting_source := 'manual';
  end if;
  return new;
end;
$$;
drop trigger if exists class_sessions_validate on public.class_sessions;
create trigger class_sessions_validate before insert or update on public.class_sessions
  for each row execute function public.class_sessions_validate();

create or replace function public.class_sessions_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.class_sessions := coalesce(new, old);
  changed jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value
      and n.key not in ('updated_at', 'google_sync_status', 'google_sync_error', 'google_synced_at', 'google_event_id');
    if changed = '{}'::jsonb then
      return new;
    end if;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (rec.organization_id, auth.uid(),
          case tg_op when 'INSERT' then 'session.created' when 'UPDATE' then 'session.updated' else 'session.deleted' end,
          'class_session', rec.id,
          case when tg_op = 'UPDATE' then jsonb_build_object('changed', changed)
               else jsonb_build_object('title', rec.title, 'starts_at', rec.starts_at, 'batch_id', rec.batch_id) end);
  return rec;
end;
$$;
drop trigger if exists class_sessions_audit on public.class_sessions;
create trigger class_sessions_audit after insert or update or delete on public.class_sessions
  for each row execute function public.class_sessions_audit();

create or replace function public.session_attendees_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.class_sessions s where s.id = new.session_id and s.organization_id = new.organization_id and s.kind = 'demo') then
    raise exception 'Invitees can only be added to demo sessions' using errcode = '23514';
  end if;
  if not exists (select 1 from public.candidates c where c.id = new.candidate_id and c.organization_id = new.organization_id) then
    raise exception 'Candidate not found' using errcode = '23503';
  end if;
  return new;
end;
$$;
drop trigger if exists session_attendees_validate on public.session_attendees;
create trigger session_attendees_validate before insert or update on public.session_attendees
  for each row execute function public.session_attendees_validate();

create or replace function public.attendance_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.class_sessions;
  enr uuid;
begin
  if tg_op = 'UPDATE' and (new.session_id <> old.session_id or new.candidate_id <> old.candidate_id or new.organization_id <> old.organization_id) then
    raise exception 'An attendance record cannot move to another session or person' using errcode = '42501';
  end if;
  select * into s from public.class_sessions where id = new.session_id;
  if s.id is null or s.organization_id <> new.organization_id then
    raise exception 'Session not found' using errcode = '23503';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Attendance cannot be recorded for a cancelled session' using errcode = 'ARATT';
  end if;
  if s.starts_at > now() + interval '30 minutes' then
    raise exception 'Attendance opens 30 minutes before the session starts' using errcode = 'ARATT';
  end if;
  if s.kind = 'class' then
    select e.id into enr from public.enrollments e
    where e.batch_id = s.batch_id and e.candidate_id = new.candidate_id and e.status <> 'cancelled'
    order by public.enrollment_holds_seat(e.status) desc, e.enrolled_at desc
    limit 1;
    if enr is null then
      raise exception 'This person is not enrolled in the batch for this session' using errcode = 'ARATT';
    end if;
    new.enrollment_id := enr;
  else
    if not exists (select 1 from public.session_attendees a where a.session_id = s.id and a.candidate_id = new.candidate_id) then
      raise exception 'This person was not invited to this demo session' using errcode = 'ARATT';
    end if;
    new.enrollment_id := null;
  end if;
  new.recorded_by := auth.uid();
  new.recorded_at := now();
  return new;
end;
$$;
drop trigger if exists attendance_validate on public.attendance_records;
create trigger attendance_validate before insert or update on public.attendance_records
  for each row execute function public.attendance_validate();

-- Attending a demo moves an early-stage lead to "Demo Attended".
create or replace function public.attendance_demo_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if new.status not in ('present', 'late') then
    return new;
  end if;
  if not exists (select 1 from public.class_sessions s where s.id = new.session_id and s.kind = 'demo') then
    return new;
  end if;
  select id into target from public.lead_statuses where organization_id = new.organization_id and key = 'demo_attended';
  if target is null then
    return new;
  end if;
  update public.candidates c set lead_status_id = target
  where c.id = new.candidate_id
    and exists (select 1 from public.lead_statuses ls
                where ls.id = c.lead_status_id
                  and ls.key in ('new', 'contacted', 'interested', 'demo_requested', 'demo_shared'));
  return new;
end;
$$;
drop trigger if exists attendance_demo_lead_status on public.attendance_records;
create trigger attendance_demo_lead_status after insert or update of status on public.attendance_records
  for each row execute function public.attendance_demo_lead_status();

drop trigger if exists google_integrations_updated_at on public.google_integrations;
create trigger google_integrations_updated_at before update on public.google_integrations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Read functions for rosters (names for instructors without CRM access)
-- -----------------------------------------------------------------------------

create or replace function public.get_batch_roster(p_batch uuid)
returns table (
  enrollment_id  uuid,
  candidate_id   uuid,
  full_name      text,
  email          text,
  phone          text,
  status         public.enrollment_status,
  enrolled_at    timestamptz,
  notes          text,
  can_view_candidate boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, c.id, c.full_name,
         case when public.can_view_candidate(c.organization_id, c.owner_id) or b.instructor_id = (select auth.uid()) then c.email end,
         case when public.can_view_candidate(c.organization_id, c.owner_id) or b.instructor_id = (select auth.uid()) then c.phone end,
         e.status, e.enrolled_at, e.notes,
         public.can_view_candidate(c.organization_id, c.owner_id)
  from public.batches b
  join public.enrollments e on e.batch_id = b.id
  join public.candidates c on c.id = e.candidate_id
  where b.id = p_batch
    and public.can_view_batch(b.organization_id, b.instructor_id)
  order by (e.status in ('dropped', 'cancelled')), lower(c.full_name);
$$;

-- People expected at a session with their attendance: the batch roster for a
-- class (dropped students only when they already have a mark), the invitees for a demo.
create or replace function public.get_session_people(p_session uuid)
returns table (
  candidate_id       uuid,
  full_name          text,
  email              text,
  enrollment_status  public.enrollment_status,
  attendance         public.attendance_status,
  note               text,
  recorded_by        uuid,
  recorded_at        timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select * from public.class_sessions
    where id = p_session and public.can_view_session(organization_id, batch_id, instructor_id)
  ),
  people as (
    select distinct on (e.candidate_id) e.candidate_id, e.status as enrollment_status
    from s join public.enrollments e on e.batch_id = s.batch_id
    where s.kind = 'class' and e.status <> 'cancelled'
    order by e.candidate_id, public.enrollment_holds_seat(e.status) desc, e.enrolled_at desc
  ),
  invited as (
    select a.candidate_id, null::public.enrollment_status as enrollment_status
    from s join public.session_attendees a on a.session_id = s.id
    where s.kind = 'demo'
  ),
  everyone as (select * from people union all select * from invited)
  select p.candidate_id, c.full_name,
         case when public.can_view_candidate(c.organization_id, c.owner_id) then c.email end,
         p.enrollment_status, r.status, r.note, r.recorded_by, r.recorded_at
  from everyone p
  join public.candidates c on c.id = p.candidate_id
  left join public.attendance_records r on r.session_id = p_session and r.candidate_id = p.candidate_id
  where p.enrollment_status is null or public.enrollment_holds_seat(p.enrollment_status) or r.id is not null
  order by lower(c.full_name);
$$;

-- Instructors (attendance.record) can add the recording link and mark their
-- session as held without full session-editing rights.
create or replace function public.record_session_outcome(p_session uuid, p_recording_url text, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.class_sessions;
begin
  select * into s from public.class_sessions where id = p_session;
  if s.id is null or not (public.can_record_attendance(s.id) or public.has_permission(s.organization_id, 'sessions.manage')) then
    raise exception 'Session not found' using errcode = '42501';
  end if;
  if p_recording_url is not null and (p_recording_url !~* '^https://' or char_length(p_recording_url) > 500) then
    raise exception 'The recording link must start with https://' using errcode = '22023';
  end if;
  if s.status = 'cancelled' and p_completed then
    raise exception 'A cancelled session cannot be marked as held' using errcode = 'ARATT';
  end if;
  update public.class_sessions
     set recording_url = p_recording_url,
         status = case when p_completed then 'completed'::public.session_status
                       when s.status = 'completed' then 'scheduled'::public.session_status
                       else s.status end
   where id = p_session;
end;
$$;

-- Owner/admin/instructor members who can be assigned to teach.
create or replace function public.list_instructor_options(p_org uuid)
returns table (user_id uuid, full_name text, email text, role public.member_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, p.full_name, p.email, m.role
  from public.organization_memberships m
  join public.user_profiles p on p.id = m.user_id
  where m.organization_id = p_org and m.status = 'active'
    and m.role in ('owner', 'admin', 'instructor')
    and (public.has_permission(p_org, 'batches.manage') or public.has_permission(p_org, 'sessions.manage'))
  order by (m.role = 'instructor') desc, lower(coalesce(p.full_name, p.email));
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.batches              enable row level security;
alter table public.enrollments          enable row level security;
alter table public.class_sessions       enable row level security;
alter table public.session_attendees    enable row level security;
alter table public.attendance_records   enable row level security;
alter table public.google_integrations  enable row level security;

drop policy if exists "batch viewers read batches" on public.batches;
create policy "batch viewers read batches" on public.batches for select to authenticated
  using (public.can_view_batch(organization_id, instructor_id));
drop policy if exists "batch managers add batches" on public.batches;
create policy "batch managers add batches" on public.batches for insert to authenticated
  with check (public.has_permission(organization_id, 'batches.manage'));
drop policy if exists "batch managers update batches" on public.batches;
create policy "batch managers update batches" on public.batches for update to authenticated
  using (public.has_permission(organization_id, 'batches.manage'))
  with check (public.has_permission(organization_id, 'batches.manage'));
drop policy if exists "batch managers delete batches" on public.batches;
create policy "batch managers delete batches" on public.batches for delete to authenticated
  using (public.has_permission(organization_id, 'batches.manage'));

drop policy if exists "read enrollments of visible candidates or batches" on public.enrollments;
create policy "read enrollments of visible candidates or batches" on public.enrollments for select to authenticated
  using (public.can_view_candidate_id(candidate_id) or (batch_id is not null and public.can_view_batch_id(batch_id)));
drop policy if exists "enrollment managers add enrollments" on public.enrollments;
create policy "enrollment managers add enrollments" on public.enrollments for insert to authenticated
  with check (public.has_permission(organization_id, 'enrollments.manage')
              and public.can_view_candidate_id(candidate_id)
              and (batch_id is null or public.can_view_batch_id(batch_id))
              and created_by = (select auth.uid()));
drop policy if exists "enrollment managers update enrollments" on public.enrollments;
create policy "enrollment managers update enrollments" on public.enrollments for update to authenticated
  using (public.has_permission(organization_id, 'enrollments.manage') and public.can_view_candidate_id(candidate_id))
  with check (public.has_permission(organization_id, 'enrollments.manage')
              and public.can_view_candidate_id(candidate_id)
              and (batch_id is null or public.can_view_batch_id(batch_id)));

drop policy if exists "session viewers read sessions" on public.class_sessions;
create policy "session viewers read sessions" on public.class_sessions for select to authenticated
  using (public.can_view_session(organization_id, batch_id, instructor_id));
drop policy if exists "session managers add sessions" on public.class_sessions;
create policy "session managers add sessions" on public.class_sessions for insert to authenticated
  with check (public.has_permission(organization_id, 'sessions.manage'));
drop policy if exists "session managers update sessions" on public.class_sessions;
create policy "session managers update sessions" on public.class_sessions for update to authenticated
  using (public.has_permission(organization_id, 'sessions.manage'))
  with check (public.has_permission(organization_id, 'sessions.manage'));
drop policy if exists "session managers delete sessions" on public.class_sessions;
create policy "session managers delete sessions" on public.class_sessions for delete to authenticated
  using (public.has_permission(organization_id, 'sessions.manage'));

drop policy if exists "session viewers read invitees" on public.session_attendees;
create policy "session viewers read invitees" on public.session_attendees for select to authenticated
  using (public.can_view_session_id(session_id) or public.can_view_candidate_id(candidate_id));
drop policy if exists "session managers write invitees" on public.session_attendees;
create policy "session managers write invitees" on public.session_attendees for all to authenticated
  using (public.has_permission(organization_id, 'sessions.manage'))
  with check (public.has_permission(organization_id, 'sessions.manage') and public.can_view_candidate_id(candidate_id));

drop policy if exists "read attendance of visible sessions or candidates" on public.attendance_records;
create policy "read attendance of visible sessions or candidates" on public.attendance_records for select to authenticated
  using (public.can_view_session_id(session_id) or public.can_view_candidate_id(candidate_id));
drop policy if exists "attendance takers add records" on public.attendance_records;
create policy "attendance takers add records" on public.attendance_records for insert to authenticated
  with check (public.can_record_attendance(session_id));
drop policy if exists "attendance takers update records" on public.attendance_records;
create policy "attendance takers update records" on public.attendance_records for update to authenticated
  using (public.can_record_attendance(session_id))
  with check (public.can_record_attendance(session_id));
drop policy if exists "attendance takers remove records" on public.attendance_records;
create policy "attendance takers remove records" on public.attendance_records for delete to authenticated
  using (public.can_record_attendance(session_id));

drop policy if exists "integration and session managers read google status" on public.google_integrations;
create policy "integration and session managers read google status" on public.google_integrations for select to authenticated
  using (public.has_permission(organization_id, 'integrations.manage')
         or public.has_permission(organization_id, 'sessions.manage'));

-- -----------------------------------------------------------------------------
-- Table grants (Supabase's defaults grant everything to anon/authenticated)
-- -----------------------------------------------------------------------------

revoke all on public.batches, public.enrollments, public.class_sessions, public.session_attendees,
  public.attendance_records, public.google_integrations
  from anon, authenticated;

grant select, insert, update, delete on public.batches to authenticated;
grant select on public.enrollments to authenticated;
grant insert (organization_id, candidate_id, batch_id, course_id, status, enrolled_at, notes, created_by)
  on public.enrollments to authenticated;
grant update (batch_id, status, enrolled_at, notes) on public.enrollments to authenticated;
grant select, delete on public.class_sessions to authenticated;
-- Google fields are written only by the server after it talks to Google.
grant insert (organization_id, kind, batch_id, course_id, title, description, prep_notes, starts_at, ends_at, timezone,
              instructor_id, status, meeting_url, meeting_source, recording_url, notes, google_add_attendees, created_by)
  on public.class_sessions to authenticated;
grant update (title, description, prep_notes, starts_at, ends_at, timezone, instructor_id, status, meeting_url,
              meeting_source, recording_url, notes, google_add_attendees)
  on public.class_sessions to authenticated;
grant select, insert, delete on public.session_attendees to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;
grant select (organization_id, status, calendar_id, connected_by, connected_at, last_error, last_error_at, updated_at)
  on public.google_integrations to authenticated;

grant all on public.batches, public.enrollments, public.class_sessions, public.session_attendees,
  public.attendance_records, public.google_integrations to service_role;

-- -----------------------------------------------------------------------------
-- Function grants: only this migration's functions (others keep theirs)
-- -----------------------------------------------------------------------------

revoke execute on function public.can_view_batch(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_view_batch_id(uuid) from public, anon, authenticated;
revoke execute on function public.can_view_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_view_session_id(uuid) from public, anon, authenticated;
revoke execute on function public.can_record_attendance(uuid) from public, anon, authenticated;
revoke execute on function public.is_active_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.enrollment_holds_seat(public.enrollment_status) from public, anon, authenticated;
revoke execute on function public.get_batch_roster(uuid) from public, anon, authenticated;
revoke execute on function public.get_session_people(uuid) from public, anon, authenticated;
revoke execute on function public.list_instructor_options(uuid) from public, anon, authenticated;
revoke execute on function public.record_session_outcome(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.refresh_batch_fullness(uuid) from public, anon, authenticated;
revoke execute on function public.batches_validate() from public, anon, authenticated;
revoke execute on function public.batches_audit() from public, anon, authenticated;
revoke execute on function public.enrollments_before_write() from public, anon, authenticated;
revoke execute on function public.enrollments_after_write() from public, anon, authenticated;
revoke execute on function public.class_sessions_validate() from public, anon, authenticated;
revoke execute on function public.class_sessions_audit() from public, anon, authenticated;
revoke execute on function public.session_attendees_validate() from public, anon, authenticated;
revoke execute on function public.attendance_validate() from public, anon, authenticated;
revoke execute on function public.attendance_demo_lead_status() from public, anon, authenticated;

grant execute on function public.can_view_batch(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_view_batch_id(uuid) to authenticated, service_role;
grant execute on function public.can_view_session(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_view_session_id(uuid) to authenticated, service_role;
grant execute on function public.can_record_attendance(uuid) to authenticated, service_role;
grant execute on function public.is_active_member(uuid, uuid) to service_role;
grant execute on function public.enrollment_holds_seat(public.enrollment_status) to authenticated, service_role;
grant execute on function public.get_batch_roster(uuid) to authenticated, service_role;
grant execute on function public.get_session_people(uuid) to authenticated, service_role;
grant execute on function public.list_instructor_options(uuid) to authenticated, service_role;
grant execute on function public.record_session_outcome(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.refresh_batch_fullness(uuid) to service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000011_finance.sql

-- =============================================================================
-- Adrenaline Rush: fees, installments, payments, refunds, receipts, expenses
-- and the optional Razorpay payment links (roadmap phase 6). Safe to re-run.
--
-- Money rules
--   * Every amount is numeric(12,2) with a char(3) currency. No floats anywhere.
--   * A fee plan belongs to exactly one enrollment. final_fee = base_fee - discount
--     is computed here, never trusted from a client.
--   * When a plan has installments, they must add up to final_fee exactly
--     (checked at COMMIT by a deferred constraint trigger, so a schedule can be
--     replaced inside one transaction / one save_fee_plan() call).
--   * Payments and refunds are never deleted: they are voided with a reason.
--     Only "completed" payments count as collected; pending/failed/voided never do.
--   * A refund can never exceed what is left of its payment (row lock + sum check).
--   * Installment status is derived on the fly: completed payments (net of their
--     refunds) are applied in payment-date order, first to the installment the
--     payment was recorded against (if any), then to the earliest unpaid ones.
--     Nothing is stored, so a payment can never be counted twice.
--   * Receipt numbers are sequential per organization and year: AR-2026-0001.
--   * Gateway (Razorpay) payments are written only by the server's webhook through
--     record_gateway_payment(), idempotently by the Razorpay payment id.
--
-- Visibility: finance.view reads, finance.manage writes. Staff and instructors
-- have neither by default, so they cannot read a single payment row.
-- =============================================================================

do $$ begin
  create type public.finance_payment_method as enum ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'razorpay', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.finance_payment_status as enum ('pending', 'completed', 'failed', 'voided');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.fee_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  enrollment_id    uuid not null unique references public.enrollments (id) on delete restrict,
  -- Copied from the enrollment by a trigger (never from the client).
  candidate_id     uuid not null references public.candidates (id) on delete restrict,
  course_id        uuid not null references public.courses (id) on delete restrict,
  currency         char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  base_fee         numeric(12, 2) not null check (base_fee >= 0),
  discount_type    text not null default 'none' check (discount_type in ('none', 'amount', 'percent')),
  discount_value   numeric(12, 2) not null default 0 check (discount_value >= 0),
  discount_amount  numeric(12, 2) not null default 0,
  discount_reason  text check (discount_reason is null or char_length(discount_reason) <= 300),
  final_fee        numeric(12, 2) not null default 0,
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (discount_amount >= 0 and discount_amount <= base_fee),
  check (final_fee = base_fee - discount_amount)
);
create index if not exists fee_plans_org_idx on public.fee_plans (organization_id, created_at desc);
create index if not exists fee_plans_candidate_idx on public.fee_plans (candidate_id);
create index if not exists fee_plans_course_idx on public.fee_plans (course_id);

create table if not exists public.fee_installments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete cascade,
  seq              smallint not null check (seq between 1 and 60),
  due_date         date not null,
  amount           numeric(12, 2) not null check (amount > 0),
  label            text check (label is null or char_length(label) <= 80),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (fee_plan_id, seq)
);
create index if not exists fee_installments_due_idx on public.fee_installments (organization_id, due_date);

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id       uuid not null references public.fee_plans (id) on delete restrict,
  -- Copied from the fee plan by a trigger.
  enrollment_id     uuid not null references public.enrollments (id) on delete restrict,
  candidate_id      uuid not null references public.candidates (id) on delete restrict,
  -- Optional: the installment the payer meant to pay (applied there first).
  installment_id    uuid references public.fee_installments (id) on delete set null,
  amount            numeric(12, 2) not null check (amount > 0),
  currency          char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_on           date not null,
  method            public.finance_payment_method not null,
  reference         text check (reference is null or char_length(reference) <= 120),
  notes             text check (notes is null or char_length(notes) <= 2000),
  status            public.finance_payment_status not null default 'completed',
  receipt_number    text check (receipt_number is null or char_length(receipt_number) <= 40),
  gateway           text check (gateway is null or gateway = 'razorpay'),
  gateway_payment_id text check (gateway_payment_id is null or gateway_payment_id ~ '^[A-Za-z0-9_]{6,64}$'),
  gateway_link_id   text check (gateway_link_id is null or char_length(gateway_link_id) <= 64),
  void_reason       text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  voided_at         timestamptz,
  voided_by         uuid references public.user_profiles (id) on delete set null,
  recorded_by       uuid references public.user_profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, receipt_number),
  check ((method = 'razorpay') = (gateway_payment_id is not null)),
  check ((gateway is null) = (gateway_payment_id is null)),
  check (status <> 'voided' or (void_reason is not null and voided_at is not null))
);
create index if not exists payments_org_paid_idx on public.payments (organization_id, paid_on desc);
create index if not exists payments_plan_idx on public.payments (fee_plan_id, paid_on);
create index if not exists payments_candidate_idx on public.payments (candidate_id);
-- Webhook idempotency: one row per Razorpay payment, however often it is delivered.
create unique index if not exists payments_gateway_payment_key on public.payments (gateway_payment_id) where gateway_payment_id is not null;

create table if not exists public.payment_refunds (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  payment_id       uuid not null references public.payments (id) on delete restrict,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete restrict,
  amount           numeric(12, 2) not null check (amount > 0),
  refunded_on      date not null,
  method           public.finance_payment_method not null default 'bank_transfer',
  reference        text check (reference is null or char_length(reference) <= 120),
  reason           text not null check (char_length(btrim(reason)) between 3 and 500),
  status           text not null default 'completed' check (status in ('completed', 'voided')),
  void_reason      text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  voided_at        timestamptz,
  voided_by        uuid references public.user_profiles (id) on delete set null,
  recorded_by      uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'voided' or (void_reason is not null and voided_at is not null))
);
create index if not exists payment_refunds_payment_idx on public.payment_refunds (payment_id);
create index if not exists payment_refunds_org_idx on public.payment_refunds (organization_id, refunded_on desc);

-- Next receipt number per organization and year.
create table if not exists public.receipt_counters (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  year             integer not null check (year between 2000 and 2999),
  last_number      integer not null default 0 check (last_number >= 0),
  primary key (organization_id, year)
);

create table if not exists public.expense_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  position         integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists expense_categories_name_key on public.expense_categories (organization_id, lower(name));

create table if not exists public.expenses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  category_id      uuid not null references public.expense_categories (id) on delete restrict,
  spent_on         date not null,
  amount           numeric(12, 2) not null check (amount > 0),
  currency         char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  description      text not null check (char_length(btrim(description)) between 1 and 200),
  vendor           text check (vendor is null or char_length(vendor) <= 120),
  method           public.finance_payment_method not null default 'bank_transfer',
  reference        text check (reference is null or char_length(reference) <= 120),
  notes            text check (notes is null or char_length(notes) <= 2000),
  receipt_url      text check (receipt_url is null or (receipt_url ~* '^https://' and char_length(receipt_url) <= 500)),
  course_id        uuid references public.courses (id) on delete set null,
  batch_id         uuid references public.batches (id) on delete set null,
  status           text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason      text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  voided_at        timestamptz,
  voided_by        uuid references public.user_profiles (id) on delete set null,
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'voided' or (void_reason is not null and voided_at is not null))
);
create index if not exists expenses_org_spent_idx on public.expenses (organization_id, spent_on desc);
create index if not exists expenses_category_idx on public.expenses (category_id);
create index if not exists expenses_course_idx on public.expenses (course_id);
create index if not exists expenses_batch_idx on public.expenses (batch_id);

-- Razorpay payment links created from a fee plan (optional integration).
create table if not exists public.payment_links (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id       uuid not null references public.fee_plans (id) on delete restrict,
  installment_id    uuid references public.fee_installments (id) on delete set null,
  amount            numeric(12, 2) not null check (amount >= 1),
  currency          char(3) not null check (currency ~ '^[A-Z]{3}$'),
  provider          text not null default 'razorpay' check (provider = 'razorpay'),
  provider_link_id  text unique check (provider_link_id is null or provider_link_id ~ '^[A-Za-z0-9_]{6,64}$'),
  short_url         text check (short_url is null or (short_url ~* '^https://' and char_length(short_url) <= 500)),
  status            text not null default 'creating' check (status in ('creating', 'created', 'paid', 'partially_paid', 'expired', 'cancelled', 'failed')),
  error             text check (error is null or char_length(error) <= 500),
  payment_id        uuid references public.payments (id) on delete set null,
  paid_at           timestamptz,
  created_by        uuid references public.user_profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payment_links_plan_idx on public.payment_links (fee_plan_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Raised for rule violations whose message is written for people (shown as is).
-- SQLSTATE 'ARFIN'.

create or replace function public.org_today(org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = org), 'Asia/Kolkata'))::date;
$$;

-- Reserves the next receipt number for an organization and year.
create or replace function public.next_receipt_number(org uuid, yr integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.receipt_counters as rc (organization_id, year, last_number)
  values (org, yr, 1)
  on conflict (organization_id, year) do update set last_number = rc.last_number + 1
  returning rc.last_number into n;
  return 'AR-' || yr::text || '-' || lpad(n::text, 4, '0');
end;
$$;

create or replace function public.seed_expense_categories(org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.expense_categories (organization_id, name, position) values
    (org, 'Marketing & ads', 1),
    (org, 'Software & tools', 2),
    (org, 'Trainer payout', 3),
    (org, 'Venue', 4),
    (org, 'Equipment', 5),
    (org, 'Other', 6)
  on conflict do nothing;
$$;

create or replace function public.organizations_seed_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_expense_categories(new.id);
  return new;
end;
$$;
drop trigger if exists organizations_seed_finance on public.organizations;
create trigger organizations_seed_finance after insert on public.organizations
  for each row execute function public.organizations_seed_finance();

-- Existing organizations get the default categories once (only when they have none).
select public.seed_expense_categories(o.id)
from public.organizations o
where not exists (select 1 from public.expense_categories c where c.organization_id = o.id);

-- -----------------------------------------------------------------------------
-- Triggers: fee plans and installments
-- -----------------------------------------------------------------------------

drop trigger if exists fee_plans_updated_at on public.fee_plans;
create trigger fee_plans_updated_at before update on public.fee_plans
  for each row execute function public.set_updated_at();
drop trigger if exists fee_installments_updated_at on public.fee_installments;
create trigger fee_installments_updated_at before update on public.fee_installments
  for each row execute function public.set_updated_at();

create or replace function public.fee_plans_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  enr record;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.enrollment_id <> old.enrollment_id then
      raise exception 'A fee plan cannot move to another enrollment' using errcode = 'ARFIN';
    end if;
    if new.currency <> old.currency and exists (select 1 from public.payments p where p.fee_plan_id = new.id) then
      raise exception 'The currency cannot change once payments are recorded' using errcode = 'ARFIN';
    end if;
  end if;
  select e.organization_id, e.candidate_id, e.course_id into enr from public.enrollments e where e.id = new.enrollment_id;
  if not found or enr.organization_id <> new.organization_id then
    raise exception 'Enrollment belongs to another organization' using errcode = '23503';
  end if;
  new.candidate_id := enr.candidate_id;
  new.course_id := enr.course_id;

  if new.discount_type = 'none' then
    new.discount_value := 0;
    new.discount_amount := 0;
  elsif new.discount_type = 'amount' then
    if new.discount_value > new.base_fee then
      raise exception 'The discount cannot be more than the fee' using errcode = 'ARFIN';
    end if;
    new.discount_amount := new.discount_value;
  else
    if new.discount_value > 100 then
      raise exception 'A percentage discount cannot be more than 100%%' using errcode = 'ARFIN';
    end if;
    -- Half-up rounding to the paisa, same as the app's percentOf().
    new.discount_amount := round(new.base_fee * new.discount_value / 100, 2);
  end if;
  new.final_fee := new.base_fee - new.discount_amount;
  new.discount_reason := nullif(btrim(coalesce(new.discount_reason, '')), '');
  if new.discount_amount > 0 and new.discount_reason is null then
    raise exception 'Give a reason for the discount' using errcode = 'ARFIN';
  end if;
  return new;
end;
$$;
drop trigger if exists fee_plans_before_write on public.fee_plans;
create trigger fee_plans_before_write before insert or update on public.fee_plans
  for each row execute function public.fee_plans_before_write();

create or replace function public.fee_installments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.fee_plan_id <> old.fee_plan_id or new.organization_id <> old.organization_id) then
    raise exception 'An installment cannot move to another fee plan' using errcode = 'ARFIN';
  end if;
  if not exists (select 1 from public.fee_plans f where f.id = new.fee_plan_id and f.organization_id = new.organization_id) then
    raise exception 'Fee plan belongs to another organization' using errcode = '23503';
  end if;
  new.label := nullif(btrim(coalesce(new.label, '')), '');
  return new;
end;
$$;
drop trigger if exists fee_installments_before_write on public.fee_installments;
create trigger fee_installments_before_write before insert or update on public.fee_installments
  for each row execute function public.fee_installments_before_write();

-- Installments (when there are any) must add up to the final fee. Deferred to
-- COMMIT so a whole schedule can be replaced in one transaction.
create or replace function public.check_fee_plan_installments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_id uuid;
  fee numeric;
  total numeric;
  cnt integer;
begin
  -- Same function for both tables: read the plan id without naming a field the other table lacks.
  plan_id := (to_jsonb(coalesce(new, old)) ->> case when tg_table_name = 'fee_plans' then 'id' else 'fee_plan_id' end)::uuid;
  select f.final_fee into fee from public.fee_plans f where f.id = plan_id;
  if not found then
    return null;
  end if;
  select count(*), coalesce(sum(i.amount), 0) into cnt, total from public.fee_installments i where i.fee_plan_id = plan_id;
  if cnt > 0 and total <> fee then
    raise exception 'Installments add up to % but the final fee is %. Make them equal.', total, fee using errcode = 'ARFIN';
  end if;
  return null;
end;
$$;
drop trigger if exists fee_installments_sum_check on public.fee_installments;
create constraint trigger fee_installments_sum_check after insert or update or delete on public.fee_installments
  deferrable initially deferred
  for each row execute function public.check_fee_plan_installments();
drop trigger if exists fee_plans_sum_check on public.fee_plans;
create constraint trigger fee_plans_sum_check after insert or update on public.fee_plans
  deferrable initially deferred
  for each row execute function public.check_fee_plan_installments();

-- -----------------------------------------------------------------------------
-- Triggers: payments and refunds
-- -----------------------------------------------------------------------------

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
drop trigger if exists payment_refunds_updated_at on public.payment_refunds;
create trigger payment_refunds_updated_at before update on public.payment_refunds
  for each row execute function public.set_updated_at();

create or replace function public.payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan record;
begin
  if tg_op = 'INSERT' then
    select f.organization_id, f.enrollment_id, f.candidate_id, f.currency into plan from public.fee_plans f where f.id = new.fee_plan_id;
    if not found or plan.organization_id <> new.organization_id then
      raise exception 'Fee plan belongs to another organization' using errcode = '23503';
    end if;
    new.enrollment_id := plan.enrollment_id;
    new.candidate_id := plan.candidate_id;
    new.currency := coalesce(new.currency, plan.currency);
    if new.currency <> plan.currency then
      raise exception 'Record the payment in the fee plan''s currency (%)', plan.currency using errcode = 'ARFIN';
    end if;
    if new.installment_id is not null
       and not exists (select 1 from public.fee_installments i where i.id = new.installment_id and i.fee_plan_id = new.fee_plan_id) then
      raise exception 'That installment belongs to another fee plan' using errcode = 'ARFIN';
    end if;
    if new.status = 'voided' then
      raise exception 'A new payment cannot start as voided' using errcode = 'ARFIN';
    end if;
    if new.status = 'completed' and new.paid_on > public.org_today(new.organization_id) + 1 then
      raise exception 'A received payment cannot be dated in the future' using errcode = 'ARFIN';
    end if;
    new.receipt_number := null;
    new.void_reason := null;
    new.voided_at := null;
    new.voided_by := null;
  else
    if new.organization_id <> old.organization_id or new.fee_plan_id <> old.fee_plan_id or new.amount <> old.amount
       or new.currency <> old.currency or new.paid_on <> old.paid_on or new.method <> old.method
       or new.gateway_payment_id is distinct from old.gateway_payment_id or new.receipt_number is distinct from old.receipt_number
       and old.receipt_number is not null then
      raise exception 'Payments cannot be edited. Void it with a reason and record it again.' using errcode = 'ARFIN';
    end if;
    new.enrollment_id := old.enrollment_id;
    new.candidate_id := old.candidate_id;
    if new.installment_id is distinct from old.installment_id and new.installment_id is not null
       and not exists (select 1 from public.fee_installments i where i.id = new.installment_id and i.fee_plan_id = new.fee_plan_id) then
      raise exception 'That installment belongs to another fee plan' using errcode = 'ARFIN';
    end if;
    if new.status <> old.status then
      if old.status = 'voided' then
        raise exception 'A voided payment cannot be changed' using errcode = 'ARFIN';
      end if;
      if old.status = 'completed' and new.status <> 'voided' then
        raise exception 'A received payment can only be voided' using errcode = 'ARFIN';
      end if;
      if old.status = 'failed' and new.status <> 'voided' then
        raise exception 'A failed payment can only be voided' using errcode = 'ARFIN';
      end if;
      if new.status = 'voided' then
        if exists (select 1 from public.payment_refunds r where r.payment_id = new.id and r.status = 'completed') then
          raise exception 'Void the refunds of this payment first' using errcode = 'ARFIN';
        end if;
        new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
        if new.void_reason is null then
          raise exception 'Give a reason for voiding the payment' using errcode = 'ARFIN';
        end if;
        new.voided_at := now();
        new.voided_by := auth.uid();
      end if;
    elsif old.status = 'voided' and (new.void_reason is distinct from old.void_reason or new.installment_id is distinct from old.installment_id) then
      raise exception 'A voided payment cannot be changed' using errcode = 'ARFIN';
    end if;
    if new.status <> 'voided' then
      new.void_reason := old.void_reason;
      new.voided_at := old.voided_at;
      new.voided_by := old.voided_by;
    end if;
  end if;
  -- Every received payment gets the next receipt number, once.
  if new.status = 'completed' and new.receipt_number is null then
    new.receipt_number := public.next_receipt_number(new.organization_id, extract(year from new.paid_on)::integer);
  end if;
  return new;
end;
$$;
drop trigger if exists payments_before_write on public.payments;
create trigger payments_before_write before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.payment_refunds_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  already numeric;
begin
  if tg_op = 'INSERT' then
    -- Lock the payment so two refunds recorded at the same moment cannot both pass.
    select p.organization_id, p.fee_plan_id, p.amount, p.status, p.paid_on, p.currency into pay
    from public.payments p where p.id = new.payment_id for update;
    if not found or pay.organization_id <> new.organization_id then
      raise exception 'Payment belongs to another organization' using errcode = '23503';
    end if;
    if pay.status <> 'completed' then
      raise exception 'Only received payments can be refunded' using errcode = 'ARFIN';
    end if;
    if new.refunded_on < pay.paid_on then
      raise exception 'A refund cannot be dated before its payment' using errcode = 'ARFIN';
    end if;
    if new.refunded_on > public.org_today(new.organization_id) + 1 then
      raise exception 'A refund cannot be dated in the future' using errcode = 'ARFIN';
    end if;
    select coalesce(sum(r.amount), 0) into already from public.payment_refunds r where r.payment_id = new.payment_id and r.status = 'completed';
    if already + new.amount > pay.amount then
      raise exception 'Refunds cannot exceed the payment: % % can still be refunded', pay.currency, (pay.amount - already) using errcode = 'ARFIN';
    end if;
    new.fee_plan_id := pay.fee_plan_id;
    new.status := 'completed';
    new.reason := btrim(new.reason);
    new.void_reason := null;
    new.voided_at := null;
    new.voided_by := null;
  else
    if new.payment_id <> old.payment_id or new.amount <> old.amount or new.refunded_on <> old.refunded_on
       or new.organization_id <> old.organization_id or new.fee_plan_id <> old.fee_plan_id then
      raise exception 'Refunds cannot be edited. Void it with a reason and record it again.' using errcode = 'ARFIN';
    end if;
    if old.status = 'voided' then
      raise exception 'A voided refund cannot be changed' using errcode = 'ARFIN';
    end if;
    if new.status = 'voided' then
      new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
      if new.void_reason is null then
        raise exception 'Give a reason for voiding the refund' using errcode = 'ARFIN';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists payment_refunds_before_write on public.payment_refunds;
create trigger payment_refunds_before_write before insert or update on public.payment_refunds
  for each row execute function public.payment_refunds_before_write();

-- -----------------------------------------------------------------------------
-- Triggers: expenses, categories, payment links
-- -----------------------------------------------------------------------------

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
drop trigger if exists expense_categories_updated_at on public.expense_categories;
create trigger expense_categories_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();
drop trigger if exists payment_links_updated_at on public.payment_links;
create trigger payment_links_updated_at before update on public.payment_links
  for each row execute function public.set_updated_at();

create or replace function public.expenses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_course uuid;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'Expenses cannot move between organizations' using errcode = '42501';
    end if;
    if old.status = 'voided' then
      raise exception 'A voided expense cannot be changed' using errcode = 'ARFIN';
    end if;
  end if;
  if not exists (select 1 from public.expense_categories c where c.id = new.category_id and c.organization_id = new.organization_id) then
    raise exception 'Expense category belongs to another organization' using errcode = '23503';
  end if;
  if new.course_id is not null and not exists (select 1 from public.courses c where c.id = new.course_id and c.organization_id = new.organization_id) then
    raise exception 'Course belongs to another organization' using errcode = '23503';
  end if;
  if new.batch_id is not null then
    select b.course_id into batch_course from public.batches b where b.id = new.batch_id and b.organization_id = new.organization_id;
    if not found then
      raise exception 'Batch belongs to another organization' using errcode = '23503';
    end if;
    if new.course_id is null then
      new.course_id := batch_course;
    elsif new.course_id <> batch_course then
      raise exception 'The batch belongs to a different course' using errcode = 'ARFIN';
    end if;
  end if;
  if new.method = 'razorpay' then
    raise exception 'Choose how the expense was paid (cash, UPI, bank transfer, card, cheque or other)' using errcode = 'ARFIN';
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'voided' then
      raise exception 'A new expense cannot start as voided' using errcode = 'ARFIN';
    end if;
    new.void_reason := null;
    new.voided_at := null;
    new.voided_by := null;
  elsif new.status = 'voided' then
    new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
    if new.void_reason is null then
      raise exception 'Give a reason for voiding the expense' using errcode = 'ARFIN';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists expenses_before_write on public.expenses;
create trigger expenses_before_write before insert or update on public.expenses
  for each row execute function public.expenses_before_write();

create or replace function public.payment_links_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.fee_plans f where f.id = new.fee_plan_id and f.organization_id = new.organization_id and f.currency = new.currency) then
    raise exception 'Fee plan belongs to another organization or uses another currency' using errcode = '23503';
  end if;
  if new.installment_id is not null
     and not exists (select 1 from public.fee_installments i where i.id = new.installment_id and i.fee_plan_id = new.fee_plan_id) then
    raise exception 'That installment belongs to another fee plan' using errcode = 'ARFIN';
  end if;
  -- Only the verified webhook (no signed-in user) may mark a link as paid.
  if auth.uid() is not null and new.status in ('paid', 'partially_paid')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'Only Razorpay can mark a payment link as paid' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.amount <> old.amount or new.fee_plan_id <> old.fee_plan_id or new.organization_id <> old.organization_id) then
    raise exception 'A payment link cannot be edited' using errcode = 'ARFIN';
  end if;
  return new;
end;
$$;
drop trigger if exists payment_links_before_write on public.payment_links;
create trigger payment_links_before_write before insert or update on public.payment_links
  for each row execute function public.payment_links_before_write();

-- -----------------------------------------------------------------------------
-- Audit: every money change is written to audit_logs by the database
-- -----------------------------------------------------------------------------

create or replace function public.finance_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity text := tg_argv[0];
  rec jsonb := to_jsonb(coalesce(new, old));
  changed jsonb := '{}'::jsonb;
  act text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at');
    if changed = '{}'::jsonb then
      return new;
    end if;
    act := case when changed ? 'status' and changed ->> 'status' = 'voided' then entity || '.voided' else entity || '.updated' end;
  else
    act := entity || case when tg_op = 'INSERT' then '.created' else '.deleted' end;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    (rec ->> 'organization_id')::uuid,
    auth.uid(),
    act,
    entity,
    (rec ->> 'id')::uuid,
    case
      when tg_op = 'UPDATE' then jsonb_build_object('changed', changed)
      else jsonb_strip_nulls(jsonb_build_object(
        'amount', rec -> 'amount', 'currency', rec -> 'currency', 'final_fee', rec -> 'final_fee',
        'base_fee', rec -> 'base_fee', 'discount_amount', rec -> 'discount_amount', 'status', rec -> 'status',
        'fee_plan_id', rec -> 'fee_plan_id', 'payment_id', rec -> 'payment_id', 'enrollment_id', rec -> 'enrollment_id',
        'receipt_number', rec -> 'receipt_number', 'method', rec -> 'method', 'due_date', rec -> 'due_date',
        'seq', rec -> 'seq', 'name', rec -> 'name', 'description', rec -> 'description', 'reason', rec -> 'reason'))
    end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists fee_plans_audit on public.fee_plans;
create trigger fee_plans_audit after insert or update or delete on public.fee_plans
  for each row execute function public.finance_audit('fee_plan');
drop trigger if exists fee_installments_audit on public.fee_installments;
create trigger fee_installments_audit after insert or update or delete on public.fee_installments
  for each row execute function public.finance_audit('fee_installment');
drop trigger if exists payments_audit on public.payments;
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.finance_audit('payment');
drop trigger if exists payment_refunds_audit on public.payment_refunds;
create trigger payment_refunds_audit after insert or update or delete on public.payment_refunds
  for each row execute function public.finance_audit('payment_refund');
drop trigger if exists expenses_audit on public.expenses;
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function public.finance_audit('expense');
drop trigger if exists expense_categories_audit on public.expense_categories;
-- Not on insert: default categories are seeded when an organization is created.
create trigger expense_categories_audit after update or delete on public.expense_categories
  for each row execute function public.finance_audit('expense_category');
drop trigger if exists payment_links_audit on public.payment_links;
create trigger payment_links_audit after insert or update or delete on public.payment_links
  for each row execute function public.finance_audit('payment_link');

-- -----------------------------------------------------------------------------
-- Calculations (SECURITY INVOKER: Row Level Security applies to the caller)
-- -----------------------------------------------------------------------------

-- Per fee plan: collected, refunded, net, outstanding and credit.
create or replace view public.fee_plan_balances
with (security_invoker = true)
as
select
  f.id as fee_plan_id,
  f.organization_id,
  f.enrollment_id,
  f.candidate_id,
  f.course_id,
  f.currency,
  f.final_fee,
  coalesce(p.gross, 0)::numeric(12, 2) as gross_paid,
  coalesce(r.refunded, 0)::numeric(12, 2) as refunded,
  (coalesce(p.gross, 0) - coalesce(r.refunded, 0))::numeric(12, 2) as net_paid,
  greatest(f.final_fee - (coalesce(p.gross, 0) - coalesce(r.refunded, 0)), 0)::numeric(12, 2) as outstanding,
  greatest((coalesce(p.gross, 0) - coalesce(r.refunded, 0)) - f.final_fee, 0)::numeric(12, 2) as credit
from public.fee_plans f
left join lateral (
  select sum(x.amount) as gross from public.payments x where x.fee_plan_id = f.id and x.status = 'completed'
) p on true
left join lateral (
  select sum(y.amount) as refunded from public.payment_refunds y where y.fee_plan_id = f.id and y.status = 'completed'
) r on true;

-- How much of each installment is paid (see the header for the rules).
create or replace function public.fee_plan_allocation(p_plan uuid)
returns table (installment_id uuid, paid numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  ids uuid[];
  amts numeric[];
  rem numeric[];
  n integer;
  i integer;
  idx integer;
  net numeric;
  take numeric;
  pay record;
begin
  select array_agg(x.id order by x.seq), array_agg(x.amount order by x.seq) into ids, amts
  from public.fee_installments x where x.fee_plan_id = p_plan;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then
    return;
  end if;
  rem := amts;
  for pay in
    select p.installment_id as target,
           p.amount - coalesce((select sum(r.amount) from public.payment_refunds r where r.payment_id = p.id and r.status = 'completed'), 0) as net
    from public.payments p
    where p.fee_plan_id = p_plan and p.status = 'completed'
    order by p.paid_on, p.created_at, p.id
  loop
    net := pay.net;
    continue when net <= 0;
    if pay.target is not null then
      idx := array_position(ids, pay.target);
      if idx is not null then
        take := least(net, rem[idx]);
        rem[idx] := rem[idx] - take;
        net := net - take;
      end if;
    end if;
    i := 1;
    while net > 0 and i <= n loop
      take := least(net, rem[i]);
      rem[i] := rem[i] - take;
      net := net - take;
      i := i + 1;
    end loop;
  end loop;
  for i in 1 .. n loop
    installment_id := ids[i];
    paid := amts[i] - rem[i];
    return next;
  end loop;
end;
$$;

-- Installments with paid amount and status: paid / partially_paid / due / overdue.
create or replace function public.fee_plan_schedule(p_plan uuid, p_today date default null)
returns table (
  installment_id uuid,
  seq smallint,
  label text,
  due_date date,
  amount numeric,
  paid numeric,
  remaining numeric,
  status text
)
language sql
stable
set search_path = ''
as $$
  with today as (
    select coalesce(p_today, public.org_today(f.organization_id)) as d from public.fee_plans f where f.id = p_plan
  )
  select i.id, i.seq, i.label, i.due_date, i.amount, a.paid, i.amount - a.paid,
         case
           when a.paid >= i.amount then 'paid'
           when i.due_date < (select d from today) then 'overdue'
           when a.paid > 0 then 'partially_paid'
           else 'due'
         end
  from public.fee_installments i
  join public.fee_plan_allocation(p_plan) a on a.installment_id = i.id
  order by i.seq;
$$;

-- Enrollments whose fees still count (cancelled and dropped ones are no longer payable).
create or replace function public.enrollment_fee_qualifies(s public.enrollment_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s in ('pending', 'active', 'on_hold', 'completed');
$$;

-- Unpaid installments past their due date, for the overview and reminders.
create or replace function public.finance_overdue_installments(p_org uuid, p_course uuid default null, p_batch uuid default null, p_today date default null)
returns table (
  fee_plan_id uuid,
  enrollment_id uuid,
  candidate_id uuid,
  course_id uuid,
  batch_id uuid,
  currency text,
  installment_id uuid,
  seq smallint,
  label text,
  due_date date,
  amount numeric,
  remaining numeric,
  days_overdue integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  plan record;
  s record;
  today date := coalesce(p_today, public.org_today(p_org));
begin
  if not public.has_permission(p_org, 'finance.view') then
    raise exception 'You do not have permission to view finance' using errcode = '42501';
  end if;
  for plan in
    select f.id, f.enrollment_id, f.candidate_id, f.course_id, e.batch_id, f.currency
    from public.fee_plans f
    join public.enrollments e on e.id = f.enrollment_id
    where f.organization_id = p_org
      and public.enrollment_fee_qualifies(e.status)
      and (p_course is null or f.course_id = p_course)
      and (p_batch is null or e.batch_id = p_batch)
      and exists (select 1 from public.fee_installments i where i.fee_plan_id = f.id and i.due_date < today)
  loop
    for s in select * from public.fee_plan_schedule(plan.id, today) x where x.status = 'overdue' loop
      fee_plan_id := plan.id;
      enrollment_id := plan.enrollment_id;
      candidate_id := plan.candidate_id;
      course_id := plan.course_id;
      batch_id := plan.batch_id;
      currency := plan.currency;
      installment_id := s.installment_id;
      seq := s.seq;
      label := s.label;
      due_date := s.due_date;
      amount := s.amount;
      remaining := s.remaining;
      days_overdue := today - s.due_date;
      return next;
    end loop;
  end loop;
end;
$$;

-- Totals for the overview. Period filters use the payment / refund / expense
-- dates (calendar dates in the business time zone). Only rows in the business
-- currency are added up; others are counted in other_currency_rows.
create or replace function public.finance_summary(
  p_org uuid,
  p_from date default null,
  p_to date default null,
  p_course uuid default null,
  p_batch uuid default null
)
returns table (
  currency text,
  booked numeric,
  gross numeric,
  refunds numeric,
  net numeric,
  expenses numeric,
  cash_result numeric,
  outstanding numeric,
  overdue numeric,
  overdue_count integer,
  payment_count integer,
  expense_count integer,
  other_currency_rows integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  cur text;
begin
  if not public.has_permission(p_org, 'finance.view') then
    raise exception 'You do not have permission to view finance' using errcode = '42501';
  end if;
  select o.default_currency into cur from public.organizations o where o.id = p_org;
  currency := cur;

  select coalesce(sum(f.final_fee), 0) into booked
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
  where f.organization_id = p_org and f.currency = cur and public.enrollment_fee_qualifies(e.status)
    and (p_course is null or f.course_id = p_course) and (p_batch is null or e.batch_id = p_batch)
    and (p_from is null or e.enrolled_at::date >= p_from) and (p_to is null or e.enrolled_at::date <= p_to);

  select coalesce(sum(p.amount), 0), count(*) into gross, payment_count
  from public.payments p join public.fee_plans f on f.id = p.fee_plan_id join public.enrollments e on e.id = p.enrollment_id
  where p.organization_id = p_org and p.status = 'completed' and p.currency = cur
    and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to)
    and (p_course is null or f.course_id = p_course) and (p_batch is null or e.batch_id = p_batch);

  select coalesce(sum(r.amount), 0) into refunds
  from public.payment_refunds r join public.fee_plans f on f.id = r.fee_plan_id join public.enrollments e on e.id = f.enrollment_id
  where r.organization_id = p_org and r.status = 'completed' and f.currency = cur
    and (p_from is null or r.refunded_on >= p_from) and (p_to is null or r.refunded_on <= p_to)
    and (p_course is null or f.course_id = p_course) and (p_batch is null or e.batch_id = p_batch);

  select coalesce(sum(x.amount), 0), count(*) into expenses, expense_count
  from public.expenses x
  where x.organization_id = p_org and x.status = 'recorded' and x.currency = cur
    and (p_from is null or x.spent_on >= p_from) and (p_to is null or x.spent_on <= p_to)
    and (p_course is null or x.course_id = p_course) and (p_batch is null or x.batch_id = p_batch);

  net := gross - refunds;
  cash_result := net - expenses;

  select coalesce(sum(b.outstanding), 0) into outstanding
  from public.fee_plan_balances b join public.enrollments e on e.id = b.enrollment_id
  where b.organization_id = p_org and b.currency = cur and public.enrollment_fee_qualifies(e.status)
    and (p_course is null or b.course_id = p_course) and (p_batch is null or e.batch_id = p_batch);

  select coalesce(sum(o.remaining), 0), count(*) into overdue, overdue_count
  from public.finance_overdue_installments(p_org, p_course, p_batch) o
  where o.currency = cur;

  select
    (select count(*) from public.payments p where p.organization_id = p_org and p.status = 'completed' and p.currency <> cur
       and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to))
    + (select count(*) from public.expenses x where x.organization_id = p_org and x.status = 'recorded' and x.currency <> cur
       and (p_from is null or x.spent_on >= p_from) and (p_to is null or x.spent_on <= p_to))
  into other_currency_rows;
  return next;
end;
$$;

-- Creates or updates the fee plan of an enrollment and replaces its schedule
-- in one transaction. Installments keep their ids by position (seq) so payments
-- recorded against "installment 2" stay attached to it.
create or replace function public.save_fee_plan(
  p_enrollment uuid,
  p_currency text,
  p_base_fee numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_discount_reason text,
  p_notes text,
  p_installments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  org uuid;
  plan_id uuid;
  item jsonb;
  n integer := 0;
begin
  select e.organization_id into org from public.enrollments e where e.id = p_enrollment;
  if org is null then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(org, 'finance.manage') then
    raise exception 'You do not have permission to manage fees' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) > 60 then
    raise exception 'Use at most 60 installments' using errcode = 'ARFIN';
  end if;

  insert into public.fee_plans as fp (organization_id, enrollment_id, candidate_id, course_id, currency, base_fee,
                                      discount_type, discount_value, discount_reason, notes, created_by)
  select org, p_enrollment, e.candidate_id, e.course_id, upper(p_currency), p_base_fee, p_discount_type, coalesce(p_discount_value, 0),
         p_discount_reason, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  from public.enrollments e where e.id = p_enrollment
  on conflict (enrollment_id) do update set
    currency = excluded.currency,
    base_fee = excluded.base_fee,
    discount_type = excluded.discount_type,
    discount_value = excluded.discount_value,
    discount_reason = excluded.discount_reason,
    notes = excluded.notes
  returning fp.id into plan_id;

  for item in select * from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) loop
    n := n + 1;
    insert into public.fee_installments as fi (organization_id, fee_plan_id, seq, due_date, amount, label)
    values (org, plan_id, n, (item ->> 'due_date')::date, (item ->> 'amount')::numeric, item ->> 'label')
    on conflict (fee_plan_id, seq) do update set due_date = excluded.due_date, amount = excluded.amount, label = excluded.label
      where (fi.due_date, fi.amount, fi.label) is distinct from (excluded.due_date, excluded.amount, excluded.label);
  end loop;
  delete from public.fee_installments i where i.fee_plan_id = plan_id and i.seq > n;
  -- Run the deferred "installments add up" check now, so the caller gets a clear error.
  set constraints all immediate;
  return plan_id;
end;
$$;

-- Records a fee reminder on the candidate's timeline (no amounts: people who
-- can see the timeline but not finance learn nothing about money).
create or replace function public.log_fee_reminder(p_plan uuid, p_channel text, p_status text, p_installment uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan record;
begin
  select f.organization_id, f.candidate_id into plan from public.fee_plans f where f.id = p_plan;
  if not found or not public.has_permission(plan.organization_id, 'finance.manage') then
    raise exception 'You do not have permission to send fee reminders' using errcode = '42501';
  end if;
  if p_channel not in ('whatsapp', 'email') or p_status not in ('opened', 'sent', 'failed', 'not_sent') then
    raise exception 'Unknown reminder channel or status' using errcode = '22023';
  end if;
  insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
  values (plan.organization_id, plan.candidate_id, 'fee_reminder',
          case
            when p_channel = 'whatsapp' then 'Fee reminder opened in WhatsApp'
            when p_status = 'sent' then 'Fee reminder emailed'
            when p_status = 'failed' then 'Fee reminder email failed'
            else 'Fee reminder email not sent (no email provider)'
          end,
          jsonb_build_object('channel', p_channel, 'status', p_status, 'fee_plan_id', p_plan, 'installment_id', p_installment),
          auth.uid());
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (plan.organization_id, auth.uid(), 'fee_plan.reminder', 'fee_plan', p_plan,
          jsonb_build_object('channel', p_channel, 'status', p_status, 'installment_id', p_installment));
end;
$$;

-- Called only by the server's verified Razorpay webhook (service role).
-- Idempotent by Razorpay payment id; amounts come from Razorpay's signed
-- payload, never from a browser.
create or replace function public.record_gateway_payment(
  p_provider_link_id text,
  p_gateway_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_link_status text default 'paid'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  pay_id uuid;
  existing uuid;
  tz text;
begin
  if p_amount_paise is null or p_amount_paise <= 0 then
    return jsonb_build_object('result', 'invalid_amount');
  end if;
  select l.* into link from public.payment_links l where l.provider_link_id = p_provider_link_id for update;
  if not found then
    return jsonb_build_object('result', 'unknown_link');
  end if;
  select p.id into existing from public.payments p where p.gateway_payment_id = p_gateway_payment_id;
  if existing is not null then
    return jsonb_build_object('result', 'duplicate', 'payment_id', existing);
  end if;
  if upper(p_currency) <> link.currency then
    update public.payment_links set error = 'Paid in another currency: ' || upper(p_currency) where id = link.id;
    return jsonb_build_object('result', 'currency_mismatch');
  end if;
  select o.timezone into tz from public.organizations o where o.id = link.organization_id;

  insert into public.payments (organization_id, fee_plan_id, installment_id, amount, currency, paid_on, method, reference,
                               notes, status, gateway, gateway_payment_id, gateway_link_id)
  values (link.organization_id, link.fee_plan_id, link.installment_id, (p_amount_paise::numeric / 100)::numeric(12, 2), link.currency,
          (coalesce(p_paid_at, now()) at time zone coalesce(tz, 'Asia/Kolkata'))::date, 'razorpay', p_gateway_payment_id,
          'Paid online through a Razorpay payment link', 'completed', 'razorpay', p_gateway_payment_id, p_provider_link_id)
  on conflict (gateway_payment_id) where gateway_payment_id is not null do nothing
  returning id into pay_id;
  if pay_id is null then
    select p.id into existing from public.payments p where p.gateway_payment_id = p_gateway_payment_id;
    return jsonb_build_object('result', 'duplicate', 'payment_id', existing);
  end if;

  update public.payment_links
  set status = case when p_link_status in ('paid', 'partially_paid') then p_link_status else 'paid' end,
      payment_id = pay_id, paid_at = coalesce(p_paid_at, now()), error = null
  where id = link.id;
  return jsonb_build_object('result', 'recorded', 'payment_id', pay_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Email log: allow fee reminder emails
-- -----------------------------------------------------------------------------

alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check check (kind in ('automation', 'test', 'share', 'fee_reminder'));

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.fee_plans           enable row level security;
alter table public.fee_installments    enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_refunds     enable row level security;
alter table public.receipt_counters    enable row level security;
alter table public.expense_categories  enable row level security;
alter table public.expenses            enable row level security;
alter table public.payment_links       enable row level security;

drop policy if exists "finance viewers read fee plans" on public.fee_plans;
create policy "finance viewers read fee plans" on public.fee_plans for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers add fee plans" on public.fee_plans;
create policy "finance managers add fee plans" on public.fee_plans for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers update fee plans" on public.fee_plans;
create policy "finance managers update fee plans" on public.fee_plans for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));
drop policy if exists "finance managers delete fee plans" on public.fee_plans;
create policy "finance managers delete fee plans" on public.fee_plans for delete to authenticated
  using (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read installments" on public.fee_installments;
create policy "finance viewers read installments" on public.fee_installments for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers write installments" on public.fee_installments;
create policy "finance managers write installments" on public.fee_installments for all to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read payments" on public.payments;
create policy "finance viewers read payments" on public.payments for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers record payments" on public.payments;
create policy "finance managers record payments" on public.payments for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and recorded_by = (select auth.uid()));
drop policy if exists "finance managers update payments" on public.payments;
create policy "finance managers update payments" on public.payments for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read refunds" on public.payment_refunds;
create policy "finance viewers read refunds" on public.payment_refunds for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers record refunds" on public.payment_refunds;
create policy "finance managers record refunds" on public.payment_refunds for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and recorded_by = (select auth.uid()));
drop policy if exists "finance managers update refunds" on public.payment_refunds;
create policy "finance managers update refunds" on public.payment_refunds for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read expense categories" on public.expense_categories;
create policy "finance viewers read expense categories" on public.expense_categories for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers write expense categories" on public.expense_categories;
create policy "finance managers write expense categories" on public.expense_categories for all to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read expenses" on public.expenses;
create policy "finance viewers read expenses" on public.expenses for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers record expenses" on public.expenses;
create policy "finance managers record expenses" on public.expenses for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers update expenses" on public.expenses;
create policy "finance managers update expenses" on public.expenses for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read payment links" on public.payment_links;
create policy "finance viewers read payment links" on public.payment_links for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers create payment links" on public.payment_links;
create policy "finance managers create payment links" on public.payment_links for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers update payment links" on public.payment_links;
create policy "finance managers update payment links" on public.payment_links for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

-- receipt_counters: no policies; only the definer trigger writes it.

-- -----------------------------------------------------------------------------
-- Table grants (Supabase's defaults grant everything to anon/authenticated)
-- -----------------------------------------------------------------------------

revoke all on public.fee_plans, public.fee_installments, public.payments, public.payment_refunds, public.receipt_counters,
  public.expense_categories, public.expenses, public.payment_links, public.fee_plan_balances
  from anon, authenticated;

grant select, delete on public.fee_plans to authenticated;
grant insert (organization_id, enrollment_id, candidate_id, course_id, currency, base_fee, discount_type, discount_value,
              discount_reason, notes, created_by)
  on public.fee_plans to authenticated;
grant update (currency, base_fee, discount_type, discount_value, discount_reason, notes) on public.fee_plans to authenticated;

grant select, delete on public.fee_installments to authenticated;
grant insert (organization_id, fee_plan_id, seq, due_date, amount, label) on public.fee_installments to authenticated;
grant update (due_date, amount, label) on public.fee_installments to authenticated;

-- No DELETE: payments and refunds are voided, never removed.
grant select on public.payments to authenticated;
-- enrollment_id / candidate_id are always overwritten from the fee plan by the trigger.
grant insert (organization_id, fee_plan_id, enrollment_id, candidate_id, installment_id, amount, currency, paid_on, method, reference, notes, status, recorded_by)
  on public.payments to authenticated;
grant update (status, void_reason, notes, reference, installment_id) on public.payments to authenticated;

grant select on public.payment_refunds to authenticated;
grant insert (organization_id, payment_id, fee_plan_id, amount, refunded_on, method, reference, reason, recorded_by)
  on public.payment_refunds to authenticated;
grant update (status, void_reason) on public.payment_refunds to authenticated;

grant select, insert, update, delete on public.expense_categories to authenticated;

grant select on public.expenses to authenticated;
grant insert (organization_id, category_id, spent_on, amount, currency, description, vendor, method, reference, notes,
              receipt_url, course_id, batch_id, created_by)
  on public.expenses to authenticated;
grant update (category_id, spent_on, amount, currency, description, vendor, method, reference, notes, receipt_url,
              course_id, batch_id, status, void_reason)
  on public.expenses to authenticated;

grant select on public.payment_links to authenticated;
grant insert (organization_id, fee_plan_id, installment_id, amount, currency, status, created_by) on public.payment_links to authenticated;
grant update (status, provider_link_id, short_url, error) on public.payment_links to authenticated;

grant select on public.fee_plan_balances to authenticated;

grant all on public.fee_plans, public.fee_installments, public.payments, public.payment_refunds, public.receipt_counters,
  public.expense_categories, public.expenses, public.payment_links to service_role;
grant select on public.fee_plan_balances to service_role;

-- -----------------------------------------------------------------------------
-- Function grants: only this migration's functions (others keep theirs)
-- -----------------------------------------------------------------------------

revoke execute on function public.org_today(uuid) from public, anon, authenticated;
revoke execute on function public.next_receipt_number(uuid, integer) from public, anon, authenticated;
revoke execute on function public.seed_expense_categories(uuid) from public, anon, authenticated;
revoke execute on function public.organizations_seed_finance() from public, anon, authenticated;
revoke execute on function public.fee_plans_before_write() from public, anon, authenticated;
revoke execute on function public.fee_installments_before_write() from public, anon, authenticated;
revoke execute on function public.check_fee_plan_installments() from public, anon, authenticated;
revoke execute on function public.payments_before_write() from public, anon, authenticated;
revoke execute on function public.payment_refunds_before_write() from public, anon, authenticated;
revoke execute on function public.expenses_before_write() from public, anon, authenticated;
revoke execute on function public.payment_links_before_write() from public, anon, authenticated;
revoke execute on function public.finance_audit() from public, anon, authenticated;
revoke execute on function public.fee_plan_allocation(uuid) from public, anon, authenticated;
revoke execute on function public.fee_plan_schedule(uuid, date) from public, anon, authenticated;
revoke execute on function public.enrollment_fee_qualifies(public.enrollment_status) from public, anon, authenticated;
revoke execute on function public.finance_overdue_installments(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.finance_summary(uuid, date, date, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.save_fee_plan(uuid, text, numeric, text, numeric, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.log_fee_reminder(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.record_gateway_payment(text, text, bigint, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.org_today(uuid) to authenticated, service_role;
grant execute on function public.next_receipt_number(uuid, integer) to service_role;
grant execute on function public.seed_expense_categories(uuid) to service_role;
grant execute on function public.fee_plan_allocation(uuid) to authenticated, service_role;
grant execute on function public.fee_plan_schedule(uuid, date) to authenticated, service_role;
grant execute on function public.enrollment_fee_qualifies(public.enrollment_status) to authenticated, service_role;
grant execute on function public.finance_overdue_installments(uuid, uuid, uuid, date) to authenticated, service_role;
grant execute on function public.finance_summary(uuid, date, date, uuid, uuid) to authenticated, service_role;
grant execute on function public.save_fee_plan(uuid, text, numeric, text, numeric, text, text, jsonb) to authenticated;
grant execute on function public.log_fee_reminder(uuid, text, text, uuid) to authenticated;
grant execute on function public.record_gateway_payment(text, text, bigint, text, timestamptz, text) to service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000012_analytics.sql

-- =============================================================================
-- Adrenaline Rush: analytics and reports (Phase 7)
--
-- Read-only reporting functions for /admin/analytics and the dashboard.
--
-- Rules:
--   * Every function is SECURITY INVOKER: Row Level Security applies to the
--     caller, so a member only ever counts rows they could read anyway.
--   * Every function requires reports.view (dashboard_kpis: dashboard.view).
--   * Money is only returned to callers with finance.view; otherwise the money
--     columns are NULL (never zero, so "no access" is not mistaken for "none").
--   * Money uses exactly the rules of public.finance_summary(): completed
--     payments by paid_on, completed refunds by refunded_on, recorded expenses
--     by spent_on, only in the business currency. Summing any per-month or
--     per-course figure over the same period gives the finance overview total.
--   * Periods are inclusive calendar dates (p_from .. p_to) in the business
--     time zone; timestamps are converted with "at time zone".
-- Idempotent: safe to run more than once.
-- =============================================================================

-- Business time zone of an organization (members can read their organization).
create or replace function public.analytics_tz(p_org uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'Asia/Kolkata');
$$;

-- Raises unless the caller has the permission; validates the period.
create or replace function public.analytics_check(p_org uuid, p_from date, p_to date, p_permission text default 'reports.view')
returns void
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_permission(p_org, p_permission) then
    raise exception 'You do not have permission to view analytics' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid period' using errcode = '22023';
  end if;
  if p_to - p_from > 3700 then
    raise exception 'Choose a period of ten years or less' using errcode = '22023';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Headline numbers (non-money). Money comes from public.finance_summary().
-- -----------------------------------------------------------------------------
create or replace function public.analytics_kpis(p_org uuid, p_from date, p_to date)
returns table (
  new_leads integer,
  registrations integer,
  demo_bookings integer,
  demo_enrolled integer,
  enrollments integer,
  active_students integer,
  overdue_follow_ups integer
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := public.analytics_tz(p_org);
begin
  if not (public.has_permission(p_org, 'reports.view') or public.has_permission(p_org, 'dashboard.view')) then
    raise exception 'You do not have permission to view analytics' using errcode = '42501';
  end if;
  perform public.analytics_check(p_org, p_from, p_to, case when public.has_permission(p_org, 'reports.view') then 'reports.view' else 'dashboard.view' end);

  select count(*) into new_leads from public.candidates c
  where c.organization_id = p_org and (c.created_at at time zone tz)::date between p_from and p_to;

  select count(*) into registrations from public.course_registrations r
  where r.organization_id = p_org and (r.created_at at time zone tz)::date between p_from and p_to;

  with booked as (
    select r.candidate_id from public.course_registrations r
    where r.organization_id = p_org and r.channel = 'demo_request' and (r.created_at at time zone tz)::date between p_from and p_to
    union
    select a.candidate_id from public.session_attendees a join public.class_sessions s on s.id = a.session_id
    where a.organization_id = p_org and s.kind = 'demo' and (a.created_at at time zone tz)::date between p_from and p_to
  )
  select count(*), count(*) filter (where exists (
           select 1 from public.enrollments e where e.candidate_id = b.candidate_id and e.status <> 'cancelled'))
  into demo_bookings, demo_enrolled
  from booked b;

  select count(*) into enrollments from public.enrollments e
  where e.organization_id = p_org and e.status <> 'cancelled' and (e.enrolled_at at time zone tz)::date between p_from and p_to;

  select count(distinct e.candidate_id) into active_students from public.enrollments e
  where e.organization_id = p_org and e.status = 'active';

  select count(*) into overdue_follow_ups from public.follow_up_tasks t
  where t.organization_id = p_org and t.status = 'open' and t.due_at < now();

  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Leads, registrations and enrollments per day / week / month.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_activity_series(p_org uuid, p_from date, p_to date, p_bucket text default 'month')
returns table (bucket date, leads integer, registrations integer, enrollments integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := public.analytics_tz(p_org);
begin
  perform public.analytics_check(p_org, p_from, p_to);
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'Unknown bucket' using errcode = '22023';
  end if;
  return query
  with buckets as (
    select g::date as b
    from generate_series(date_trunc(p_bucket, p_from::timestamp), date_trunc(p_bucket, p_to::timestamp), ('1 ' || p_bucket)::interval) g
  ),
  l as (
    select date_trunc(p_bucket, (c.created_at at time zone tz)::date::timestamp)::date as b, count(*)::integer as n
    from public.candidates c
    where c.organization_id = p_org and (c.created_at at time zone tz)::date between p_from and p_to
    group by 1
  ),
  r as (
    select date_trunc(p_bucket, (x.created_at at time zone tz)::date::timestamp)::date as b, count(*)::integer as n
    from public.course_registrations x
    where x.organization_id = p_org and (x.created_at at time zone tz)::date between p_from and p_to
    group by 1
  ),
  e as (
    select date_trunc(p_bucket, (x.enrolled_at at time zone tz)::date::timestamp)::date as b, count(*)::integer as n
    from public.enrollments x
    where x.organization_id = p_org and x.status <> 'cancelled' and (x.enrolled_at at time zone tz)::date between p_from and p_to
    group by 1
  )
  select buckets.b, coalesce(l.n, 0), coalesce(r.n, 0), coalesce(e.n, 0)
  from buckets
  left join l on l.b = buckets.b
  left join r on r.b = buckets.b
  left join e on e.b = buckets.b
  order by buckets.b;
end;
$$;

-- -----------------------------------------------------------------------------
-- Money in and out per month (finance.view). Same rules as finance_summary().
-- -----------------------------------------------------------------------------
create or replace function public.analytics_money_series(p_org uuid, p_from date, p_to date)
returns table (month date, collections numeric, refunds numeric, expenses numeric, net numeric, cash_result numeric)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  cur text;
begin
  perform public.analytics_check(p_org, p_from, p_to);
  if not public.has_permission(p_org, 'finance.view') then
    raise exception 'You do not have permission to view finance' using errcode = '42501';
  end if;
  select o.default_currency into cur from public.organizations o where o.id = p_org;
  return query
  with months as (
    select g::date as m
    from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') g
  ),
  p as (
    select date_trunc('month', x.paid_on::timestamp)::date as m, sum(x.amount) as s
    from public.payments x
    where x.organization_id = p_org and x.status = 'completed' and x.currency = cur and x.paid_on between p_from and p_to
    group by 1
  ),
  r as (
    select date_trunc('month', y.refunded_on::timestamp)::date as m, sum(y.amount) as s
    from public.payment_refunds y join public.fee_plans f on f.id = y.fee_plan_id
    where y.organization_id = p_org and y.status = 'completed' and f.currency = cur and y.refunded_on between p_from and p_to
    group by 1
  ),
  x as (
    select date_trunc('month', z.spent_on::timestamp)::date as m, sum(z.amount) as s
    from public.expenses z
    where z.organization_id = p_org and z.status = 'recorded' and z.currency = cur and z.spent_on between p_from and p_to
    group by 1
  )
  select months.m,
         coalesce(p.s, 0)::numeric(12, 2),
         coalesce(r.s, 0)::numeric(12, 2),
         coalesce(x.s, 0)::numeric(12, 2),
         (coalesce(p.s, 0) - coalesce(r.s, 0))::numeric(12, 2),
         (coalesce(p.s, 0) - coalesce(r.s, 0) - coalesce(x.s, 0))::numeric(12, 2)
  from months
  left join p on p.m = months.m
  left join r on r.m = months.m
  left join x on x.m = months.m
  order by months.m;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lead funnel for leads created in the period. Each lead counts at the
-- furthest stage it ever reached (current status, status history, demo
-- bookings, demo attendance, enrollments), so the funnel never widens.
--   1 new · 2 contacted · 3 demo booked / shared · 4 demo attended · 5 enrolled
-- -----------------------------------------------------------------------------
create or replace function public.analytics_status_rank(p_key text, p_is_won boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_is_won or p_key = 'enrolled' then 5
    when p_key = 'demo_attended' then 4
    when p_key in ('demo_requested', 'demo_shared') then 3
    when p_key in ('contacted', 'interested', 'follow_up', 'qualified', 'enrollment_offered') then 2
    else 1
  end;
$$;

create or replace function public.analytics_funnel(p_org uuid, p_from date, p_to date)
returns table (stage integer, key text, label text, candidates integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := public.analytics_tz(p_org);
begin
  perform public.analytics_check(p_org, p_from, p_to);
  return query
  with cohort as (
    select c.id, c.lead_status_id, c.last_contacted_at
    from public.candidates c
    where c.organization_id = p_org and (c.created_at at time zone tz)::date between p_from and p_to
  ),
  ranked as (
    select greatest(
      1,
      coalesce((select public.analytics_status_rank(s.key, s.is_won) from public.lead_statuses s where s.id = co.lead_status_id), 1),
      coalesce((select max(public.analytics_status_rank(s.key, s.is_won))
                from public.lead_status_history h join public.lead_statuses s on s.id = h.to_status_id
                where h.candidate_id = co.id), 1),
      case when co.last_contacted_at is not null then 2 else 1 end,
      case when exists (select 1 from public.course_registrations r where r.candidate_id = co.id and r.channel = 'demo_request')
             or exists (select 1 from public.session_attendees a join public.class_sessions s on s.id = a.session_id
                        where a.candidate_id = co.id and s.kind = 'demo') then 3 else 1 end,
      case when exists (select 1 from public.attendance_records ar join public.class_sessions s on s.id = ar.session_id
                        where ar.candidate_id = co.id and s.kind = 'demo' and ar.status in ('present', 'late')) then 4 else 1 end,
      case when exists (select 1 from public.enrollments e where e.candidate_id = co.id and e.status <> 'cancelled') then 5 else 1 end
    ) as r
    from cohort co
  ),
  stages(stage, key, fallback) as (
    values (1, 'new', 'New leads'), (2, 'contacted', 'Contacted'), (3, 'demo_shared', 'Demo booked or shared'),
           (4, 'demo_attended', 'Demo attended'), (5, 'enrolled', 'Enrolled')
  )
  select st.stage, st.key,
         case st.stage
           when 1 then st.fallback
           when 3 then st.fallback
           else coalesce((select s.label from public.lead_statuses s where s.organization_id = p_org and s.key = st.key), st.fallback)
         end,
         (select count(*)::integer from ranked where ranked.r >= st.stage)
  from stages st
  order by st.stage;
end;
$$;

-- -----------------------------------------------------------------------------
-- Leads by source and UTM campaign (first-touch attribution on the candidate).
-- -----------------------------------------------------------------------------
create or replace function public.analytics_lead_sources(p_org uuid, p_from date, p_to date)
returns table (channel text, utm_medium text, utm_campaign text, leads integer, demo_bookings integer, enrolled integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := public.analytics_tz(p_org);
begin
  perform public.analytics_check(p_org, p_from, p_to);
  return query
  select coalesce(nullif(btrim(c.utm_source), ''), nullif(btrim(c.source), ''), 'unknown') as ch,
         nullif(btrim(c.utm_medium), '') as med,
         nullif(btrim(c.utm_campaign), '') as camp,
         count(*)::integer,
         count(*) filter (where exists (select 1 from public.course_registrations r where r.candidate_id = c.id and r.channel = 'demo_request')
                             or exists (select 1 from public.session_attendees a join public.class_sessions s on s.id = a.session_id
                                        where a.candidate_id = c.id and s.kind = 'demo'))::integer,
         count(*) filter (where exists (select 1 from public.enrollments e where e.candidate_id = c.id and e.status <> 'cancelled'))::integer
  from public.candidates c
  where c.organization_id = p_org and (c.created_at at time zone tz)::date between p_from and p_to
  group by 1, 2, 3
  order by 4 desc, 1, 3 nulls first;
end;
$$;

-- -----------------------------------------------------------------------------
-- Per-course performance. revenue = net collections in the period (same as
-- finance_summary(p_course)); outstanding = as of today. Money is NULL
-- without finance.view.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_course_performance(p_org uuid, p_from date, p_to date)
returns table (
  course_id uuid,
  title text,
  status text,
  registrations integer,
  demo_bookings integer,
  enrollments integer,
  collections numeric,
  refunds numeric,
  revenue numeric,
  outstanding numeric,
  currency text
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := public.analytics_tz(p_org);
  can_money boolean := public.has_permission(p_org, 'finance.view');
  cur text;
begin
  perform public.analytics_check(p_org, p_from, p_to);
  select o.default_currency into cur from public.organizations o where o.id = p_org;
  return query
  with reg as (
    select r.course_id as id, count(*)::integer as n
    from public.course_registrations r
    where r.organization_id = p_org and r.course_id is not null and (r.created_at at time zone tz)::date between p_from and p_to
    group by 1
  ),
  -- Same definition as analytics_kpis: a demo request or an invitation to a demo session, one per person and course.
  demo as (
    select d.id, count(distinct d.cand)::integer as n
    from (
      select r.course_id as id, r.candidate_id as cand
      from public.course_registrations r
      where r.organization_id = p_org and r.course_id is not null and r.channel = 'demo_request'
        and (r.created_at at time zone tz)::date between p_from and p_to
      union
      select s.course_id, a.candidate_id
      from public.session_attendees a join public.class_sessions s on s.id = a.session_id
      where a.organization_id = p_org and s.kind = 'demo' and (a.created_at at time zone tz)::date between p_from and p_to
    ) d
    group by 1
  ),
  enr as (
    select e.course_id as id, count(*)::integer as n
    from public.enrollments e
    where e.organization_id = p_org and e.status <> 'cancelled' and (e.enrolled_at at time zone tz)::date between p_from and p_to
    group by 1
  ),
  pay as (
    select f.course_id as id, sum(p.amount) as s
    from public.payments p join public.fee_plans f on f.id = p.fee_plan_id
    where can_money and p.organization_id = p_org and p.status = 'completed' and p.currency = cur and p.paid_on between p_from and p_to
    group by 1
  ),
  ref as (
    select f.course_id as id, sum(r.amount) as s
    from public.payment_refunds r join public.fee_plans f on f.id = r.fee_plan_id
    where can_money and r.organization_id = p_org and r.status = 'completed' and f.currency = cur and r.refunded_on between p_from and p_to
    group by 1
  ),
  due as (
    select b.course_id as id, sum(b.outstanding) as s
    from public.fee_plan_balances b join public.enrollments e on e.id = b.enrollment_id
    where can_money and b.organization_id = p_org and b.currency = cur and public.enrollment_fee_qualifies(e.status)
    group by 1
  )
  select c.id, c.title, c.status::text,
         coalesce(reg.n, 0),
         coalesce(demo.n, 0),
         coalesce(enr.n, 0),
         case when can_money then coalesce(pay.s, 0)::numeric(12, 2) end,
         case when can_money then coalesce(ref.s, 0)::numeric(12, 2) end,
         case when can_money then (coalesce(pay.s, 0) - coalesce(ref.s, 0))::numeric(12, 2) end,
         case when can_money then coalesce(due.s, 0)::numeric(12, 2) end,
         cur
  from public.courses c
  left join reg on reg.id = c.id
  left join demo on demo.id = c.id
  left join enr on enr.id = c.id
  left join pay on pay.id = c.id
  left join ref on ref.id = c.id
  left join due on due.id = c.id
  where c.organization_id = p_org
    and (c.status <> 'archived' or reg.n is not null or demo.n is not null or enr.n is not null or pay.s is not null or ref.s is not null or coalesce(due.s, 0) > 0)
  order by coalesce(pay.s, 0) - coalesce(ref.s, 0) desc, coalesce(enr.n, 0) desc, coalesce(reg.n, 0) desc, c.title;
end;
$$;

-- -----------------------------------------------------------------------------
-- Attendance per batch for class sessions held in the period.
-- rate = (present + late) / (present + late + absent); excused is left out.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_batch_attendance(p_org uuid, p_from date, p_to date)
returns table (
  batch_id uuid,
  batch_name text,
  course_title text,
  sessions integer,
  marked_sessions integer,
  present integer,
  late integer,
  absent integer,
  excused integer,
  attendance_rate numeric
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := public.analytics_tz(p_org);
begin
  perform public.analytics_check(p_org, p_from, p_to);
  return query
  with s as (
    select x.id, x.batch_id
    from public.class_sessions x
    where x.organization_id = p_org and x.kind = 'class' and x.status <> 'cancelled' and x.starts_at <= now()
      and (x.starts_at at time zone tz)::date between p_from and p_to
  ),
  agg as (
    select s.batch_id,
           count(distinct s.id)::integer as sessions,
           count(distinct a.session_id)::integer as marked,
           count(*) filter (where a.status = 'present')::integer as present,
           count(*) filter (where a.status = 'late')::integer as late,
           count(*) filter (where a.status = 'absent')::integer as absent,
           count(*) filter (where a.status = 'excused')::integer as excused
    from s left join public.attendance_records a on a.session_id = s.id
    group by s.batch_id
  )
  select b.id, b.name, c.title, agg.sessions, agg.marked, agg.present, agg.late, agg.absent, agg.excused,
         case when agg.present + agg.late + agg.absent > 0
              then round(100.0 * (agg.present + agg.late) / (agg.present + agg.late + agg.absent), 1) end
  from agg
  join public.batches b on b.id = agg.batch_id
  join public.courses c on c.id = b.course_id
  order by b.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Most shared demos and resources in the period.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_top_resources(p_org uuid, p_from date, p_to date, p_limit integer default 10)
returns table (resource_id uuid, title text, shares integer, candidates integer)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := public.analytics_tz(p_org);
begin
  perform public.analytics_check(p_org, p_from, p_to);
  return query
  with u as (
    select t.rid, t.ord, sh.id as share_id, sh.candidate_id, sh.resource_titles
    from public.resource_shares sh
    cross join lateral unnest(sh.resource_ids) with ordinality as t(rid, ord)
    where sh.organization_id = p_org and (sh.created_at at time zone tz)::date between p_from and p_to
      and sh.status <> 'failed'
  )
  select u.rid,
         coalesce(max(r.title), max(u.resource_titles[u.ord]), 'Resource'),
         count(distinct u.share_id)::integer,
         count(distinct u.candidate_id)::integer
  from u left join public.resources r on r.id = u.rid
  group by u.rid
  order by 3 desc, 2
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

-- -----------------------------------------------------------------------------
-- Function grants: only this migration's functions
-- -----------------------------------------------------------------------------
revoke execute on function public.analytics_tz(uuid) from public, anon, authenticated;
revoke execute on function public.analytics_check(uuid, date, date, text) from public, anon, authenticated;
revoke execute on function public.analytics_kpis(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.analytics_activity_series(uuid, date, date, text) from public, anon, authenticated;
revoke execute on function public.analytics_money_series(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.analytics_status_rank(text, boolean) from public, anon, authenticated;
revoke execute on function public.analytics_funnel(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.analytics_lead_sources(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.analytics_course_performance(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.analytics_batch_attendance(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.analytics_top_resources(uuid, date, date, integer) from public, anon, authenticated;

grant execute on function public.analytics_tz(uuid) to authenticated, service_role;
grant execute on function public.analytics_check(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.analytics_kpis(uuid, date, date) to authenticated, service_role;
grant execute on function public.analytics_activity_series(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.analytics_money_series(uuid, date, date) to authenticated, service_role;
grant execute on function public.analytics_status_rank(text, boolean) to authenticated, service_role;
grant execute on function public.analytics_funnel(uuid, date, date) to authenticated, service_role;
grant execute on function public.analytics_lead_sources(uuid, date, date) to authenticated, service_role;
grant execute on function public.analytics_course_performance(uuid, date, date) to authenticated, service_role;
grant execute on function public.analytics_batch_attendance(uuid, date, date) to authenticated, service_role;
grant execute on function public.analytics_top_resources(uuid, date, date, integer) to authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000013_upi_payments.sql

-- =============================================================================
-- Adrenaline Rush: UPI / bank transfer payment details, candidate pay pages and
-- "I've paid" submissions that the owner verifies. Safe to re-run.
--
--   * payment_settings     one row per organization: UPI ID, payee name, own QR
--                          image, bank account details, instructions, where to
--                          show them and the confirmation email text.
--   * fee_pay_links        public /pay/<token> links per fee plan. Only the
--                          sha256 of the token is stored; the token itself is an
--                          HMAC the server can re-create (so it can be copied
--                          again) but a database copy alone cannot.
--   * payment_submissions  what a candidate reports on the pay page (UTR, amount,
--                          date, optional screenshot). ALWAYS pending until a
--                          finance manager approves it; approval records one
--                          real payment (with a receipt) through public.payments.
--
-- Visibility: anon reaches pay data only through get_fee_pay_page() and
-- submit_fee_payment_proof() with a valid token hash. Submissions are read with
-- finance.view and decided with finance.manage. The full bank account number is
-- not column-granted to app users: finance viewers read it through
-- payment_settings_account_number(); everyone else sees the last four digits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.payment_settings (
  organization_id       uuid primary key references public.organizations (id) on delete cascade,
  -- UPI ID (VPA), e.g. yourname@okhdfcbank. Stored in lower case.
  upi_vpa               text check (upi_vpa is null or (char_length(upi_vpa) <= 100 and upi_vpa ~ '^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,35}$')),
  upi_payee_name        text check (upi_payee_name is null or char_length(btrim(upi_payee_name)) between 1 and 80),
  -- Optional own QR image (media_assets, served publicly by /media/<id>).
  upi_qr_media_id       uuid references public.media_assets (id) on delete set null,
  bank_account_holder   text check (bank_account_holder is null or char_length(btrim(bank_account_holder)) between 1 and 100),
  bank_account_number   text check (bank_account_number is null or bank_account_number ~ '^[0-9]{9,18}$'),
  bank_account_last4    text generated always as (right(bank_account_number, 4)) stored,
  bank_ifsc             text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name             text check (bank_name is null or char_length(btrim(bank_name)) between 1 and 100),
  bank_branch           text check (bank_branch is null or char_length(btrim(bank_branch)) between 1 and 100),
  bank_account_type     text check (bank_account_type is null or bank_account_type in ('savings', 'current', 'other')),
  instructions          text check (instructions is null or char_length(instructions) <= 1000),
  show_on_pay_page      boolean not null default true,
  show_in_reminders     boolean not null default true,
  show_on_course_pages  boolean not null default false,
  confirm_email_enabled boolean not null default true,
  confirm_email_subject text not null default 'Payment received: {{course}}'
                        check (char_length(btrim(confirm_email_subject)) between 3 and 200),
  confirm_email_body    text not null default E'Hi {{first_name}},\n\nThank you! We have received your payment of {{amount}} for {{course}}.\nReceipt number: {{receipt_number}}\nStill payable: {{outstanding}}\n\n{{business_name}}'
                        check (char_length(btrim(confirm_email_body)) between 3 and 4000),
  updated_by            uuid references public.user_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.fee_pay_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete cascade,
  -- What the page asks for, computed live on every visit.
  amount_mode      text not null check (amount_mode in ('next_installment', 'balance')),
  -- Random per-link input to the server's HMAC (useless without the server secret).
  token_nonce      text not null check (token_nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status           text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at       timestamptz,
  revoked_by       uuid references public.user_profiles (id) on delete set null,
  open_count       integer not null default 0 check (open_count >= 0),
  last_opened_at   timestamptz,
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'revoked' or revoked_at is not null)
);
create index if not exists fee_pay_links_plan_idx on public.fee_pay_links (fee_plan_id, created_at desc);
-- One live link per fee plan; making a new one revokes the old one.
create unique index if not exists fee_pay_links_one_active on public.fee_pay_links (fee_plan_id) where status = 'active';

create table if not exists public.payment_submissions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  pay_link_id      uuid not null references public.fee_pay_links (id) on delete restrict,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete restrict,
  installment_id   uuid references public.fee_installments (id) on delete set null,
  candidate_id     uuid not null references public.candidates (id) on delete restrict,
  amount           numeric(12, 2) not null check (amount > 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_on          date not null,
  method           text not null check (method in ('upi', 'bank_transfer')),
  -- UTR / UPI reference / transaction id, upper case without spaces.
  utr              text not null check (utr ~ '^[A-Z0-9]{6,35}$'),
  note             text check (note is null or char_length(note) <= 500),
  screenshot       bytea check (screenshot is null or octet_length(screenshot) between 1 and 2097152),
  screenshot_type  text check (screenshot_type is null or screenshot_type in ('image/png', 'image/jpeg', 'image/webp')),
  has_screenshot   boolean generated always as (screenshot is not null) stored,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason    text check (reject_reason is null or char_length(btrim(reject_reason)) between 3 and 500),
  payment_id       uuid references public.payments (id) on delete restrict,
  reviewed_by      uuid references public.user_profiles (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'approved') = (payment_id is not null)),
  check (status <> 'rejected' or reject_reason is not null),
  check ((screenshot is null) = (screenshot_type is null))
);
create index if not exists payment_submissions_org_idx on public.payment_submissions (organization_id, status, created_at desc);
create index if not exists payment_submissions_plan_idx on public.payment_submissions (fee_plan_id, created_at desc);
create index if not exists payment_submissions_link_idx on public.payment_submissions (pay_link_id, created_at desc);
-- The same UTR can only be waiting for, or used by, one submission.
create unique index if not exists payment_submissions_utr_key on public.payment_submissions (organization_id, utr) where status <> 'rejected';

-- -----------------------------------------------------------------------------
-- Defaults: one settings row per organization
-- -----------------------------------------------------------------------------

create or replace function public.organizations_seed_payment_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_settings (organization_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists organizations_seed_payment_settings on public.organizations;
create trigger organizations_seed_payment_settings after insert on public.organizations
  for each row execute function public.organizations_seed_payment_settings();

insert into public.payment_settings (organization_id)
select o.id from public.organizations o
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

drop trigger if exists payment_settings_updated_at on public.payment_settings;
create trigger payment_settings_updated_at before update on public.payment_settings
  for each row execute function public.set_updated_at();
drop trigger if exists fee_pay_links_updated_at on public.fee_pay_links;
create trigger fee_pay_links_updated_at before update on public.fee_pay_links
  for each row execute function public.set_updated_at();
drop trigger if exists payment_submissions_updated_at on public.payment_submissions;
create trigger payment_submissions_updated_at before update on public.payment_submissions
  for each row execute function public.set_updated_at();

create or replace function public.payment_settings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'Payment settings cannot move to another organization' using errcode = 'ARFIN';
  end if;
  new.upi_vpa := nullif(lower(btrim(coalesce(new.upi_vpa, ''))), '');
  new.bank_ifsc := nullif(upper(btrim(coalesce(new.bank_ifsc, ''))), '');
  new.bank_account_number := nullif(regexp_replace(coalesce(new.bank_account_number, ''), '\s', '', 'g'), '');
  if new.upi_qr_media_id is not null and (tg_op = 'INSERT' or new.upi_qr_media_id is distinct from old.upi_qr_media_id)
     and not exists (select 1 from public.media_assets m where m.id = new.upi_qr_media_id and m.organization_id = new.organization_id
                     and m.content_type in ('image/png', 'image/jpeg')) then
    raise exception 'Upload the QR image again (PNG or JPG)' using errcode = 'ARFIN';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;
drop trigger if exists payment_settings_before_write on public.payment_settings;
create trigger payment_settings_before_write before insert or update on public.payment_settings
  for each row execute function public.payment_settings_before_write();

create or replace function public.fee_pay_links_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.fee_plans f where f.id = new.fee_plan_id and f.organization_id = new.organization_id) then
      raise exception 'Fee plan belongs to another organization' using errcode = '23503';
    end if;
    if new.status <> 'active' then
      raise exception 'A new pay link starts active' using errcode = 'ARFIN';
    end if;
    new.revoked_at := null;
    new.revoked_by := null;
    new.open_count := 0;
    new.last_opened_at := null;
    return new;
  end if;
  if new.organization_id <> old.organization_id or new.fee_plan_id <> old.fee_plan_id or new.token_hash <> old.token_hash
     or new.token_nonce <> old.token_nonce or new.amount_mode <> old.amount_mode or new.created_by is distinct from old.created_by then
    raise exception 'Pay links cannot be edited. Make a new one instead.' using errcode = 'ARFIN';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'A revoked pay link cannot be switched back on. Make a new one.' using errcode = 'ARFIN';
  end if;
  if new.status = 'revoked' and old.status = 'active' then
    new.revoked_at := now();
    new.revoked_by := auth.uid();
  elsif new.status = old.status then
    new.revoked_at := old.revoked_at;
    new.revoked_by := old.revoked_by;
  end if;
  return new;
end;
$$;
drop trigger if exists fee_pay_links_before_write on public.fee_pay_links;
create trigger fee_pay_links_before_write before insert or update on public.fee_pay_links
  for each row execute function public.fee_pay_links_before_write();

-- -----------------------------------------------------------------------------
-- Audit (bank account numbers are masked; page opens are not logged)
-- -----------------------------------------------------------------------------

create or replace function public.upi_payments_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity text := tg_argv[0];
  rec jsonb := to_jsonb(coalesce(new, old));
  changed jsonb := '{}'::jsonb;
  act text;
  det jsonb;
  ent_id uuid;
begin
  if entity = 'payment_settings' then
    if tg_op <> 'UPDATE' then
      return coalesce(new, old);
    end if;
    select coalesce(jsonb_object_agg(n.key, case
             when n.key = 'bank_account_number' then to_jsonb(case when n.value = 'null'::jsonb then null else '••••' || right(n.value #>> '{}', 4) end)
             else n.value end), '{}'::jsonb)
      into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by', 'bank_account_last4');
    if changed = '{}'::jsonb then
      return new;
    end if;
    act := 'payment_settings.updated';
    det := jsonb_build_object('changed', changed);
    ent_id := new.organization_id;
  elsif entity = 'pay_link' then
    if tg_op = 'INSERT' then
      act := 'pay_link.created';
    elsif tg_op = 'UPDATE' and new.status = 'revoked' and old.status <> 'revoked' then
      act := 'pay_link.revoked';
    else
      return coalesce(new, old);
    end if;
    det := jsonb_build_object('fee_plan_id', rec -> 'fee_plan_id', 'amount_mode', rec -> 'amount_mode');
    ent_id := (rec ->> 'id')::uuid;
  else
    if tg_op = 'INSERT' then
      act := 'payment_submission.created';
    elsif tg_op = 'UPDATE' and new.status <> old.status then
      act := 'payment_submission.' || new.status;
    else
      return coalesce(new, old);
    end if;
    det := jsonb_strip_nulls(jsonb_build_object('fee_plan_id', rec -> 'fee_plan_id', 'amount', rec -> 'amount', 'currency', rec -> 'currency',
             'method', rec -> 'method', 'utr', rec -> 'utr', 'payment_id', rec -> 'payment_id', 'reason', rec -> 'reject_reason'));
    ent_id := (rec ->> 'id')::uuid;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values ((rec ->> 'organization_id')::uuid, auth.uid(), act, entity, ent_id, det);
  return coalesce(new, old);
end;
$$;

drop trigger if exists payment_settings_audit on public.payment_settings;
create trigger payment_settings_audit after update on public.payment_settings
  for each row execute function public.upi_payments_audit('payment_settings');
drop trigger if exists fee_pay_links_audit on public.fee_pay_links;
create trigger fee_pay_links_audit after insert or update on public.fee_pay_links
  for each row execute function public.upi_payments_audit('pay_link');
drop trigger if exists payment_submissions_audit on public.payment_submissions;
create trigger payment_submissions_audit after insert or update on public.payment_submissions
  for each row execute function public.upi_payments_audit('payment_submission');

-- -----------------------------------------------------------------------------
-- Staff-side functions
-- -----------------------------------------------------------------------------

-- Full account number for finance viewers; null for everyone else.
create or replace function public.payment_settings_account_number(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.bank_account_number from public.payment_settings s
  where s.organization_id = p_org and public.has_permission(p_org, 'finance.view');
$$;

-- Makes the plan's pay link (revoking any live one) in one step. SECURITY
-- INVOKER: Row Level Security (finance.manage) applies to the caller.
create or replace function public.create_fee_pay_link(p_plan uuid, p_mode text, p_id uuid, p_nonce text, p_token_hash text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  org uuid;
  new_id uuid;
begin
  select f.organization_id into org from public.fee_plans f where f.id = p_plan;
  if org is null or not public.has_permission(org, 'finance.manage') then
    raise exception 'You do not have permission to manage fees' using errcode = '42501';
  end if;
  update public.fee_pay_links set status = 'revoked' where fee_plan_id = p_plan and status = 'active';
  insert into public.fee_pay_links (id, organization_id, fee_plan_id, amount_mode, token_nonce, token_hash, created_by)
  values (p_id, org, p_plan, p_mode, p_nonce, p_token_hash, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- Fee reference used in UPI notes and on the pay page, e.g. FEE-3F2A9C1B.
create or replace function public.fee_plan_reference(p_plan uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'FEE-' || upper(left(replace(p_plan::text, '-', ''), 8));
$$;

-- What a pay link asks for right now: (amount, installment, label, due date, outstanding).
create or replace function public.fee_pay_amount(p_plan uuid, p_mode text)
returns table (amount numeric, installment_id uuid, label text, due_date date, outstanding numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owed numeric;
  s record;
begin
  select b.outstanding into owed from public.fee_plan_balances b where b.fee_plan_id = p_plan;
  owed := coalesce(owed, 0);
  outstanding := owed;
  amount := owed;
  installment_id := null;
  label := null;
  due_date := null;
  if p_mode = 'next_installment' then
    select x.installment_id, x.seq, x.label, x.due_date, x.remaining into s
    from public.fee_plan_schedule(p_plan) x where x.remaining > 0 order by x.seq limit 1;
    if found then
      installment_id := s.installment_id;
      label := coalesce(s.label, 'Installment ' || s.seq);
      due_date := s.due_date;
      amount := least(s.remaining, owed);
    end if;
  end if;
  return next;
end;
$$;

-- Approve: records exactly one received payment (method upi / bank transfer,
-- reference = UTR) and links it to the submission. Raises for people (ARFIN).
create or replace function public.approve_payment_submission(p_submission uuid, p_amount numeric default null, p_paid_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.payment_submissions;
  pay_id uuid;
  receipt text;
begin
  select * into sub from public.payment_submissions s where s.id = p_submission for update;
  if not found or not public.has_permission(sub.organization_id, 'finance.manage') then
    raise exception 'You do not have permission to approve payments' using errcode = '42501';
  end if;
  if sub.status <> 'pending' then
    raise exception 'This payment was already %', case sub.status when 'approved' then 'approved' else 'rejected' end using errcode = 'ARFIN';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'Enter the amount you received' using errcode = 'ARFIN';
  end if;
  if exists (select 1 from public.payments p where p.organization_id = sub.organization_id and p.status in ('completed', 'pending')
             and upper(regexp_replace(coalesce(p.reference, ''), '\s', '', 'g')) = sub.utr) then
    raise exception 'A payment with reference % is already recorded. Reject this one as a duplicate.', sub.utr using errcode = 'ARFIN';
  end if;

  insert into public.payments (organization_id, fee_plan_id, enrollment_id, candidate_id, installment_id, amount, currency, paid_on,
                               method, reference, notes, status, recorded_by)
  select sub.organization_id, sub.fee_plan_id, f.enrollment_id, f.candidate_id, sub.installment_id, coalesce(p_amount, sub.amount), sub.currency,
         coalesce(p_paid_on, sub.paid_on), sub.method::public.finance_payment_method, sub.utr,
         left('Reported by the candidate on the pay page and checked against the bank/UPI statement.'
              || case when sub.note is not null then E'\nCandidate note: ' || sub.note else '' end, 2000),
         'completed', auth.uid()
  from public.fee_plans f where f.id = sub.fee_plan_id
  returning id, receipt_number into pay_id, receipt;

  update public.payment_submissions
  set status = 'approved', payment_id = pay_id, reviewed_by = auth.uid(), reviewed_at = now()
  where id = sub.id;
  return jsonb_build_object('payment_id', pay_id, 'receipt_number', receipt);
end;
$$;

create or replace function public.reject_payment_submission(p_submission uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.payment_submissions;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into sub from public.payment_submissions s where s.id = p_submission for update;
  if not found or not public.has_permission(sub.organization_id, 'finance.manage') then
    raise exception 'You do not have permission to reject payments' using errcode = '42501';
  end if;
  if sub.status <> 'pending' then
    raise exception 'This payment was already %', case sub.status when 'approved' then 'approved' else 'rejected' end using errcode = 'ARFIN';
  end if;
  if reason is null or char_length(reason) < 3 then
    raise exception 'Give a reason (at least 3 characters)' using errcode = 'ARFIN';
  end if;
  update public.payment_submissions
  set status = 'rejected', reject_reason = left(reason, 500), reviewed_by = auth.uid(), reviewed_at = now()
  where id = sub.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public side: only through a token hash. Callable by anon (the app calls it
-- from the server after its own rate limit); a 256-bit token cannot be guessed.
-- -----------------------------------------------------------------------------

create or replace function public.get_fee_pay_page(p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  link public.fee_pay_links;
  plan record;
  st public.payment_settings;
  amt record;
  v_show boolean;
  pending_count integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into link from public.fee_pay_links l where l.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select o.name as business_name, f.currency, f.course_id, c.full_name, co.title as course_title, e.status as enrollment_status
    into plan
  from public.fee_plans f
  join public.organizations o on o.id = f.organization_id
  join public.candidates c on c.id = f.candidate_id
  join public.enrollments e on e.id = f.enrollment_id
  left join public.courses co on co.id = f.course_id
  where f.id = link.fee_plan_id;
  if link.status <> 'active' then
    return jsonb_build_object('status', 'revoked', 'business_name', plan.business_name);
  end if;
  if not public.enrollment_fee_qualifies(plan.enrollment_status) then
    return jsonb_build_object('status', 'closed', 'business_name', plan.business_name);
  end if;

  update public.fee_pay_links set open_count = open_count + 1, last_opened_at = now() where id = link.id;
  select * into st from public.payment_settings s where s.organization_id = link.organization_id;
  select * into amt from public.fee_pay_amount(link.fee_plan_id, link.amount_mode);
  select count(*) into pending_count from public.payment_submissions s where s.pay_link_id = link.id and s.status = 'pending';
  v_show := coalesce(st.show_on_pay_page, false);

  return jsonb_build_object(
    'status', case when amt.outstanding <= 0 then 'paid' else 'ok' end,
    'business_name', plan.business_name,
    'first_name', nullif(split_part(btrim(plan.full_name), ' ', 1), ''),
    'course_title', plan.course_title,
    'currency', plan.currency,
    'amount_mode', link.amount_mode,
    'amount_due', amt.amount,
    'installment_label', amt.label,
    'due_date', amt.due_date,
    'outstanding', amt.outstanding,
    'reference', public.fee_plan_reference(link.fee_plan_id),
    'pending_submissions', pending_count,
    'details_shown', v_show,
    'upi_vpa', case when v_show then st.upi_vpa end,
    'upi_payee_name', case when v_show then st.upi_payee_name end,
    'upi_qr_media_id', case when v_show then st.upi_qr_media_id end,
    'bank', case when v_show and st.bank_account_number is not null then jsonb_build_object(
      'account_holder', st.bank_account_holder, 'account_number', st.bank_account_number, 'ifsc', st.bank_ifsc,
      'bank_name', st.bank_name, 'branch', st.bank_branch, 'account_type', st.bank_account_type) end,
    'instructions', st.instructions
  );
end;
$$;

-- Result codes: ok | not_found | revoked | closed | paid | invalid_amount |
-- invalid_date | invalid_utr | invalid_method | invalid_screenshot | duplicate_utr | too_many
create or replace function public.submit_fee_payment_proof(
  p_token_hash text,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_utr text,
  p_note text default null,
  p_screenshot bytea default null,
  p_screenshot_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.fee_pay_links;
  plan record;
  amt record;
  today date;
  v_utr text := upper(regexp_replace(coalesce(p_utr, ''), '[\s-]', '', 'g'));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('result', 'not_found');
  end if;
  select * into link from public.fee_pay_links l where l.token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if link.status <> 'active' then
    return jsonb_build_object('result', 'revoked');
  end if;
  select f.currency, f.candidate_id, e.status as enrollment_status into plan
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id where f.id = link.fee_plan_id;
  if not public.enrollment_fee_qualifies(plan.enrollment_status) then
    return jsonb_build_object('result', 'closed');
  end if;
  select * into amt from public.fee_pay_amount(link.fee_plan_id, link.amount_mode);
  if amt.outstanding <= 0 then
    return jsonb_build_object('result', 'paid');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > amt.outstanding then
    return jsonb_build_object('result', 'invalid_amount', 'max', amt.outstanding);
  end if;
  today := public.org_today(link.organization_id);
  if p_paid_on is null or p_paid_on > today + 1 or p_paid_on < today - 90 then
    return jsonb_build_object('result', 'invalid_date');
  end if;
  if p_method is null or p_method not in ('upi', 'bank_transfer') then
    return jsonb_build_object('result', 'invalid_method');
  end if;
  if v_utr !~ '^[A-Z0-9]{6,35}$' then
    return jsonb_build_object('result', 'invalid_utr');
  end if;
  if (p_screenshot is null) <> (p_screenshot_type is null)
     or (p_screenshot is not null and (octet_length(p_screenshot) > 2097152 or p_screenshot_type not in ('image/png', 'image/jpeg', 'image/webp'))) then
    return jsonb_build_object('result', 'invalid_screenshot');
  end if;
  -- Throttle per link: at most 3 waiting and 10 per day.
  if (select count(*) from public.payment_submissions s where s.pay_link_id = link.id and s.status = 'pending') >= 3
     or (select count(*) from public.payment_submissions s where s.pay_link_id = link.id and s.created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('result', 'too_many');
  end if;
  if exists (select 1 from public.payment_submissions s where s.organization_id = link.organization_id and s.utr = v_utr and s.status <> 'rejected')
     or exists (select 1 from public.payments p where p.organization_id = link.organization_id and p.status in ('completed', 'pending')
                and upper(regexp_replace(coalesce(p.reference, ''), '\s', '', 'g')) = v_utr) then
    return jsonb_build_object('result', 'duplicate_utr');
  end if;

  begin
    insert into public.payment_submissions (organization_id, pay_link_id, fee_plan_id, installment_id, candidate_id, amount, currency,
                                            paid_on, method, utr, note, screenshot, screenshot_type)
    values (link.organization_id, link.id, link.fee_plan_id, amt.installment_id, plan.candidate_id, p_amount, plan.currency,
            p_paid_on, p_method, v_utr, left(v_note, 500), p_screenshot, p_screenshot_type)
    returning id into new_id;
  exception when unique_violation then
    return jsonb_build_object('result', 'duplicate_utr');
  end;
  return jsonb_build_object('result', 'ok', 'id', new_id);
end;
$$;

-- Payment details for the public course pages (only when switched on).
create or replace function public.get_public_payment_details()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.show_on_course_pages and (s.upi_vpa is not null or s.bank_account_number is not null) then jsonb_build_object(
    'upi_vpa', s.upi_vpa,
    'upi_payee_name', s.upi_payee_name,
    'upi_qr_media_id', s.upi_qr_media_id,
    'bank', case when s.bank_account_number is not null then jsonb_build_object(
      'account_holder', s.bank_account_holder, 'account_number', s.bank_account_number, 'ifsc', s.bank_ifsc,
      'bank_name', s.bank_name, 'branch', s.bank_branch, 'account_type', s.bank_account_type) end,
    'instructions', s.instructions) end
  from public.payment_settings s
  where s.organization_id = public.primary_organization_id();
$$;

-- -----------------------------------------------------------------------------
-- Email log: allow payment confirmation emails
-- -----------------------------------------------------------------------------

alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('automation', 'test', 'share', 'fee_reminder', 'payment_confirmation'));

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.payment_settings    enable row level security;
alter table public.fee_pay_links       enable row level security;
alter table public.payment_submissions enable row level security;

drop policy if exists "payment detail editors read payment settings" on public.payment_settings;
create policy "payment detail editors read payment settings" on public.payment_settings for select to authenticated
  using (public.has_permission(organization_id, 'finance.view') or public.has_permission(organization_id, 'settings.manage'));
drop policy if exists "payment detail editors update payment settings" on public.payment_settings;
create policy "payment detail editors update payment settings" on public.payment_settings for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage') or public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'finance.manage') or public.has_permission(organization_id, 'settings.manage'));

drop policy if exists "finance viewers read pay links" on public.fee_pay_links;
create policy "finance viewers read pay links" on public.fee_pay_links for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers create pay links" on public.fee_pay_links;
create policy "finance managers create pay links" on public.fee_pay_links for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers revoke pay links" on public.fee_pay_links;
create policy "finance managers revoke pay links" on public.fee_pay_links for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read payment submissions" on public.payment_submissions;
create policy "finance viewers read payment submissions" on public.payment_submissions for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
-- No insert/update policies: submissions are written only by the functions above.

-- Payment-detail editors may upload their own QR image.
drop policy if exists "payment detail editors upload media" on public.media_assets;
create policy "payment detail editors upload media" on public.media_assets for insert to authenticated
  with check ((public.has_permission(organization_id, 'finance.manage') or public.has_permission(organization_id, 'settings.manage'))
              and created_by = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Table grants
-- -----------------------------------------------------------------------------

revoke all on public.payment_settings, public.fee_pay_links, public.payment_submissions from anon, authenticated;

-- Everything except the full account number (read via payment_settings_account_number()).
grant select (organization_id, upi_vpa, upi_payee_name, upi_qr_media_id, bank_account_holder, bank_account_last4, bank_ifsc,
              bank_name, bank_branch, bank_account_type, instructions, show_on_pay_page, show_in_reminders, show_on_course_pages,
              confirm_email_enabled, confirm_email_subject, confirm_email_body, updated_by, created_at, updated_at)
  on public.payment_settings to authenticated;
grant update (upi_vpa, upi_payee_name, upi_qr_media_id, bank_account_holder, bank_account_number, bank_ifsc, bank_name, bank_branch,
              bank_account_type, instructions, show_on_pay_page, show_in_reminders, show_on_course_pages,
              confirm_email_enabled, confirm_email_subject, confirm_email_body)
  on public.payment_settings to authenticated;

-- token_hash and token_nonce are write-only for app users.
grant select (id, organization_id, fee_plan_id, amount_mode, status, revoked_at, revoked_by, open_count, last_opened_at, created_by, created_at, updated_at)
  on public.fee_pay_links to authenticated;
grant insert (id, organization_id, fee_plan_id, amount_mode, token_nonce, token_hash, created_by) on public.fee_pay_links to authenticated;
grant update (status) on public.fee_pay_links to authenticated;

-- Screenshot bytes are not granted (served by an authenticated route).
grant select (id, organization_id, pay_link_id, fee_plan_id, installment_id, candidate_id, amount, currency, paid_on, method, utr, note,
              screenshot_type, has_screenshot, status, reject_reason, payment_id, reviewed_by, reviewed_at, created_at, updated_at)
  on public.payment_submissions to authenticated;

grant all on public.payment_settings, public.fee_pay_links, public.payment_submissions to service_role;

-- -----------------------------------------------------------------------------
-- Function grants: only this migration's functions
-- -----------------------------------------------------------------------------

revoke execute on function public.organizations_seed_payment_settings() from public, anon, authenticated;
revoke execute on function public.payment_settings_before_write() from public, anon, authenticated;
revoke execute on function public.fee_pay_links_before_write() from public, anon, authenticated;
revoke execute on function public.upi_payments_audit() from public, anon, authenticated;
revoke execute on function public.payment_settings_account_number(uuid) from public, anon, authenticated;
revoke execute on function public.create_fee_pay_link(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.fee_plan_reference(uuid) from public, anon, authenticated;
revoke execute on function public.fee_pay_amount(uuid, text) from public, anon, authenticated;
revoke execute on function public.approve_payment_submission(uuid, numeric, date) from public, anon, authenticated;
revoke execute on function public.reject_payment_submission(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_fee_pay_page(text) from public, anon, authenticated;
revoke execute on function public.submit_fee_payment_proof(text, numeric, date, text, text, text, bytea, text) from public, anon, authenticated;
revoke execute on function public.get_public_payment_details() from public, anon, authenticated;

grant execute on function public.payment_settings_account_number(uuid) to authenticated, service_role;
grant execute on function public.create_fee_pay_link(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.fee_plan_reference(uuid) to authenticated, service_role;
grant execute on function public.fee_pay_amount(uuid, text) to service_role;
grant execute on function public.approve_payment_submission(uuid, numeric, date) to authenticated;
grant execute on function public.reject_payment_submission(uuid, text) to authenticated;
grant execute on function public.get_fee_pay_page(text) to anon, authenticated, service_role;
grant execute on function public.submit_fee_payment_proof(text, numeric, date, text, text, text, bytea, text) to anon, authenticated, service_role;
grant execute on function public.get_public_payment_details() to anon, authenticated, service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000014_custom_roles.sql

-- =============================================================================
-- Adrenaline Rush: roles and access
--   * roles.manage                new permission (owner only by default) for the
--                                 Settings > Roles & access screen
--   * organization_role_permissions
--                                 per-organization changes to what the built-in
--                                 admin / staff / instructor roles can do, stored
--                                 as differences from the global defaults, so
--                                 "Reset to default" just deletes the rows
--   * custom_roles (+ custom_role_permissions)
--                                 named roles such as "Accounts" with an explicit
--                                 permission set. Each one is based on a built-in
--                                 role (admin / staff / instructor) that decides
--                                 data scope (an instructor-based role sees only
--                                 the batches it teaches) and which sign-in
--                                 switch applies. The base role is copied into
--                                 organization_memberships.role, so every policy
--                                 that looks at the role keeps working unchanged.
--   * organization_memberships.custom_role_id / team_invitations.custom_role_id
--   * permission resolution (has_permission):
--       owner -> everything; else per-member override; else the custom role's
--       permissions; else the organization's version of the built-in role;
--       else the global default.
--   * escalation rules: nobody but the owner touches admin-based roles; nobody
--     can put a permission into a role, or give someone a role, holding a
--     permission they lack themselves; roles in use cannot be deleted.
--   * every change is written to audit_logs (role.created / role.updated /
--     role.deleted / role.assigned / role.defaults_changed).
-- Existing members keep exactly the access they had: no organization rows and
-- no custom roles exist until the owner creates them.
-- Safe to re-run.
-- =============================================================================

insert into public.permissions (key, description) values
  ('roles.manage', 'Create and edit roles and what each role can do')
on conflict do nothing;

-- Owner only by default. The foundation migration grants every permission to
-- admin, so this is undone on every run (an owner can still give it to
-- administrators for their organization on the Roles & access screen).
delete from public.role_permissions where role = 'admin' and permission_key = 'roles.manage';

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.organization_role_permissions (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  role             public.member_role not null check (role <> 'owner'),
  permission_key   text not null references public.permissions (key) on delete cascade,
  allowed          boolean not null,
  updated_by       uuid references public.user_profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, role, permission_key)
);

create table if not exists public.custom_roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 60 and name = btrim(name)),
  description      text check (description is null or char_length(description) <= 300),
  base_role        public.member_role not null check (base_role in ('admin', 'staff', 'instructor')),
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index if not exists custom_roles_org_name_idx on public.custom_roles (organization_id, lower(name));

drop trigger if exists custom_roles_updated_at on public.custom_roles;
create trigger custom_roles_updated_at before update on public.custom_roles
  for each row execute function public.set_updated_at();

create table if not exists public.custom_role_permissions (
  role_id          uuid not null references public.custom_roles (id) on delete cascade,
  permission_key   text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

alter table public.organization_memberships add column if not exists custom_role_id uuid;
do $$
begin
  alter table public.organization_memberships
    add constraint organization_memberships_custom_role_fk
    foreign key (custom_role_id, organization_id) references public.custom_roles (id, organization_id) on delete restrict;
exception when duplicate_object then null;
end;
$$;
create index if not exists organization_memberships_custom_role_idx
  on public.organization_memberships (custom_role_id) where custom_role_id is not null;

alter table public.team_invitations add column if not exists custom_role_id uuid
  references public.custom_roles (id) on delete set null;
create index if not exists team_invitations_custom_role_idx
  on public.team_invitations (custom_role_id) where custom_role_id is not null;

-- -----------------------------------------------------------------------------
-- Permission resolution
-- -----------------------------------------------------------------------------

-- What a role grants in an organization, before per-member overrides.
-- Owner: everything. Custom role: its own list. Built-in: the organization's
-- version when it changed something, otherwise the global default.
create or replace function public.role_grants(org uuid, r public.member_role, custom_role uuid, permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org_allowed boolean;
begin
  if r = 'owner' then
    return true;
  end if;
  if custom_role is not null then
    return exists (select 1 from public.custom_role_permissions crp
                   where crp.role_id = custom_role and crp.permission_key = permission);
  end if;
  select orp.allowed into org_allowed
  from public.organization_role_permissions orp
  where orp.organization_id = org and orp.role = r and orp.permission_key = permission;
  if org_allowed is not null then
    return org_allowed;
  end if;
  return exists (select 1 from public.role_permissions rp where rp.role = r and rp.permission_key = permission);
end;
$$;

-- Every permission a role grants (sorted), for the escalation checks and the UI.
create or replace function public.role_permission_keys(org uuid, r public.member_role, custom_role uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.key order by p.key), '{}')
  from public.permissions p
  where public.role_grants(org, r, custom_role, p.key);
$$;

-- Effective permission of any membership (no sign-in switches; callers check
-- the membership is active). Used by has_permission and by pickers that list
-- other members.
create or replace function public.membership_permission(m public.organization_memberships, permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  override_allowed boolean;
begin
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
  return public.role_grants(m.organization_id, m.role, m.custom_role_id, permission);
end;
$$;

create or replace function public.has_permission(org_id uuid, permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.membership_permission(public.current_membership(org_id), permission);
end;
$$;

-- True when the signed-in user is an active owner of the organization.
create or replace function public.is_org_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.current_membership(org)).role = 'owner', false);
$$;

-- Raises unless the signed-in user holds every permission in keys (owners hold all).
create or replace function public.assert_holds_permissions(org uuid, keys text[], what text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  missing text[];
begin
  select array_agg(k order by k) into missing
  from unnest(coalesce(keys, '{}')) k
  where not public.has_permission(org, k);
  if missing is not null then
    raise exception '%: you do not have % yourself', what, array_to_string(missing, ', ') using errcode = '42501';
  end if;
end;
$$;

-- get_my_access plus the custom role (id and name) for the app shell. A new
-- name, because a function's result columns cannot change on re-runs.
create or replace function public.get_my_access_v2()
returns table (
  organization_id   uuid,
  organization_name text,
  organization_slug text,
  timezone          text,
  default_currency  char(3),
  membership_id     uuid,
  role              public.member_role,
  permissions       text[],
  custom_role_id    uuid,
  custom_role_name  text
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
    ),
    m.custom_role_id,
    cr.name
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  left join public.custom_roles cr on cr.id = m.custom_role_id
  where m.user_id = (select auth.uid())
    and public.is_org_member(o.id)
  order by m.created_at;
$$;

-- The candidate-owner picker resolved permissions itself; it now uses the
-- same resolution as has_permission (custom roles and organization changes).
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
    and public.membership_permission(m, 'candidates.manage')
  order by coalesce(p.full_name, p.email);
$$;

-- -----------------------------------------------------------------------------
-- Managing roles (only through these functions; the tables are read-only for
-- app users)
-- -----------------------------------------------------------------------------

create or replace function public.clean_permission_list(keys text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  unknown text[];
  result text[];
begin
  select array_agg(distinct k) into unknown
  from unnest(coalesce(keys, '{}')) k
  where not exists (select 1 from public.permissions p where p.key = k);
  if unknown is not null then
    raise exception 'Unknown permission: %', array_to_string(unknown, ', ') using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct k order by k), '{}') into result from unnest(coalesce(keys, '{}')) k;
  return result;
end;
$$;

create or replace function public.assert_can_manage_roles(org uuid, base public.member_role)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission(org, 'roles.manage') then
    raise exception 'Only the owner can change roles' using errcode = '42501';
  end if;
  if base = 'owner' then
    raise exception 'The owner role always has every permission and cannot be changed' using errcode = '42501';
  end if;
  if base = 'admin' and not public.is_org_owner(org) then
    raise exception 'Only the owner can change administrator roles' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_custom_role(
  p_org uuid,
  p_name text,
  p_description text,
  p_base_role public.member_role,
  p_permissions text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  perms text[] := public.clean_permission_list(p_permissions);
  new_id uuid;
begin
  perform public.assert_can_manage_roles(p_org, p_base_role);
  perform public.assert_holds_permissions(p_org, perms, 'You cannot create a role with permissions');
  if exists (select 1 from public.custom_roles where organization_id = p_org and lower(name) = lower(btrim(p_name))) then
    raise exception 'A role with this name already exists' using errcode = '23505';
  end if;

  insert into public.custom_roles (organization_id, name, description, base_role, created_by)
  values (p_org, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_base_role, auth.uid())
  returning id into new_id;
  insert into public.custom_role_permissions (role_id, permission_key) select new_id, k from unnest(perms) k;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (p_org, auth.uid(), 'role.created', 'custom_role', new_id,
          jsonb_build_object('name', btrim(p_name), 'base_role', p_base_role, 'permissions', to_jsonb(perms)));
  return new_id;
end;
$$;

create or replace function public.update_custom_role(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permissions text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.custom_roles;
  perms text[] := public.clean_permission_list(p_permissions);
  old_perms text[];
  added text[];
  removed text[];
begin
  select * into cr from public.custom_roles where id = p_role_id for update;
  if not found or not public.is_org_member(cr.organization_id) then
    raise exception 'That role could not be found' using errcode = 'P0002';
  end if;
  perform public.assert_can_manage_roles(cr.organization_id, cr.base_role);
  if exists (select 1 from public.custom_roles
             where organization_id = cr.organization_id and lower(name) = lower(btrim(p_name)) and id <> cr.id) then
    raise exception 'A role with this name already exists' using errcode = '23505';
  end if;

  select coalesce(array_agg(permission_key order by permission_key), '{}') into old_perms
  from public.custom_role_permissions where role_id = cr.id;
  select coalesce(array_agg(k order by k), '{}') into added from unnest(perms) k where k <> all (old_perms);
  select coalesce(array_agg(k order by k), '{}') into removed from unnest(old_perms) k where k <> all (perms);
  -- Keeping a permission you lack is fine; adding one is not.
  perform public.assert_holds_permissions(cr.organization_id, added, 'You cannot add permissions');

  update public.custom_roles
     set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), '')
   where id = cr.id;
  delete from public.custom_role_permissions where role_id = cr.id and permission_key = any (removed);
  insert into public.custom_role_permissions (role_id, permission_key)
  select cr.id, k from unnest(added) k on conflict do nothing;

  if cr.name <> btrim(p_name) or cr.description is distinct from nullif(btrim(coalesce(p_description, '')), '')
     or cardinality(added) > 0 or cardinality(removed) > 0 then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
    values (cr.organization_id, auth.uid(), 'role.updated', 'custom_role', cr.id,
            jsonb_build_object('name', btrim(p_name), 'previous_name', cr.name,
                               'added', to_jsonb(added), 'removed', to_jsonb(removed)));
  end if;
end;
$$;

create or replace function public.delete_custom_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.custom_roles;
  in_use int;
  invited int;
begin
  select * into cr from public.custom_roles where id = p_role_id for update;
  if not found or not public.is_org_member(cr.organization_id) then
    raise exception 'That role could not be found' using errcode = 'P0002';
  end if;
  perform public.assert_can_manage_roles(cr.organization_id, cr.base_role);

  select count(*) into in_use from public.organization_memberships where custom_role_id = cr.id;
  if in_use > 0 then
    raise exception '% team member(s) still have this role. Give them another role first.', in_use using errcode = '23503';
  end if;
  select count(*) into invited from public.team_invitations
   where custom_role_id = cr.id and status in ('pending', 'expired');
  if invited > 0 then
    raise exception '% open invitation(s) use this role. Cancel them first.', invited using errcode = '23503';
  end if;

  delete from public.custom_roles where id = cr.id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (cr.organization_id, auth.uid(), 'role.deleted', 'custom_role', cr.id,
          jsonb_build_object('name', cr.name, 'base_role', cr.base_role));
end;
$$;

-- Sets what a built-in role can do in this organization. Stores only the
-- differences from the global default.
create or replace function public.set_builtin_role_permissions(p_org uuid, p_role public.member_role, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  perms text[] := public.clean_permission_list(p_permissions);
  before_perms text[];
  added text[];
  removed text[];
begin
  perform public.assert_can_manage_roles(p_org, p_role);
  before_perms := public.role_permission_keys(p_org, p_role, null);
  select coalesce(array_agg(k order by k), '{}') into added from unnest(perms) k where k <> all (before_perms);
  select coalesce(array_agg(k order by k), '{}') into removed from unnest(before_perms) k where k <> all (perms);
  perform public.assert_holds_permissions(p_org, added, 'You cannot add permissions');

  delete from public.organization_role_permissions where organization_id = p_org and role = p_role;
  insert into public.organization_role_permissions (organization_id, role, permission_key, allowed, updated_by)
  select p_org, p_role, p.key, p.key = any (perms), auth.uid()
  from public.permissions p
  where (p.key = any (perms)) <> exists (select 1 from public.role_permissions rp where rp.role = p_role and rp.permission_key = p.key);

  if cardinality(added) > 0 or cardinality(removed) > 0 then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
    values (p_org, auth.uid(), 'role.defaults_changed', 'builtin_role', null,
            jsonb_build_object('role', p_role, 'added', to_jsonb(added), 'removed', to_jsonb(removed)));
  end if;
end;
$$;

create or replace function public.reset_builtin_role_permissions(p_org uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_perms text[];
  defaults text[];
  added text[];
begin
  perform public.assert_can_manage_roles(p_org, p_role);
  before_perms := public.role_permission_keys(p_org, p_role, null);
  select coalesce(array_agg(rp.permission_key order by rp.permission_key), '{}') into defaults
  from public.role_permissions rp where rp.role = p_role;
  select coalesce(array_agg(k order by k), '{}') into added from unnest(defaults) k where k <> all (before_perms);
  -- Resetting must not hand out a default permission the caller lacks.
  perform public.assert_holds_permissions(p_org, added, 'You cannot reset this role');

  delete from public.organization_role_permissions where organization_id = p_org and role = p_role;
  if before_perms is distinct from defaults then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
    values (p_org, auth.uid(), 'role.defaults_changed', 'builtin_role', null,
            jsonb_build_object('role', p_role, 'reset_to_default', true,
                               'added', to_jsonb(added),
                               'removed', (select coalesce(jsonb_agg(k order by k), '[]') from unnest(before_perms) k where k <> all (defaults))));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assigning roles to members and invitations
-- -----------------------------------------------------------------------------

-- Runs before public.enforce_membership_rules (trigger names sort that way):
-- a custom role sets the member's base role, so the owner/admin rules below
-- apply to admin-based roles too. Blocks giving a role with more than the
-- actor holds.
create or replace function public.membership_custom_role_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cr public.custom_roles;
  actor uuid := auth.uid();
begin
  if new.custom_role_id is not null then
    select * into cr from public.custom_roles where id = new.custom_role_id;
    if not found or cr.organization_id <> new.organization_id then
      raise exception 'That role does not belong to this organization' using errcode = '23503';
    end if;
    new.role := cr.base_role;
  end if;

  if actor is not null
     and (tg_op = 'INSERT' or new.role is distinct from old.role or new.custom_role_id is distinct from old.custom_role_id)
     -- Non-members and people without members.manage are stopped by RLS, and
     -- owner/admin roles by enforce_membership_rules, with clearer messages.
     and new.role not in ('owner', 'admin')
     and public.has_permission(new.organization_id, 'members.manage')
     and not public.is_org_owner(new.organization_id) then
    perform public.assert_holds_permissions(
      new.organization_id,
      public.role_permission_keys(new.organization_id, new.role, new.custom_role_id),
      'You cannot give this role');
  end if;
  return new;
end;
$$;

drop trigger if exists organization_memberships_custom_role on public.organization_memberships;
create trigger organization_memberships_custom_role
  before insert or update on public.organization_memberships
  for each row execute function public.membership_custom_role_rules();

create or replace function public.audit_membership_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role or new.custom_role_id is distinct from old.custom_role_id then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
    values (new.organization_id, auth.uid(), 'role.assigned', 'membership', new.id,
            jsonb_build_object('user_id', new.user_id,
                               'role', new.role, 'custom_role_id', new.custom_role_id,
                               'custom_role_name', (select name from public.custom_roles where id = new.custom_role_id),
                               'previous_role', old.role, 'previous_custom_role_id', old.custom_role_id));
  end if;
  return new;
end;
$$;

drop trigger if exists organization_memberships_role_audit on public.organization_memberships;
create trigger organization_memberships_role_audit
  after update on public.organization_memberships
  for each row execute function public.audit_membership_role_change();

-- Invitations: same rules as the foundation version, plus custom roles.
create or replace function public.team_invitations_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_role public.member_role;
  cr public.custom_roles;
begin
  if tg_op = 'UPDATE' then
    -- Removing the member clears the link to their membership (on delete set null),
    -- and deleting a role clears it on closed invitations.
    if (new.membership_id is null and old.membership_id is not null
        or new.custom_role_id is null and old.custom_role_id is not null)
       and (to_jsonb(new) - 'membership_id' - 'custom_role_id' - 'updated_at') = (to_jsonb(old) - 'membership_id' - 'custom_role_id' - 'updated_at')
       and (new.membership_id is null or new.membership_id = old.membership_id)
       and (new.custom_role_id is null or new.custom_role_id = old.custom_role_id) then
      return new;
    end if;
    if new.organization_id <> old.organization_id or new.email <> old.email or new.role <> old.role
       or new.custom_role_id is distinct from old.custom_role_id
       or new.invited_by is distinct from old.invited_by or new.created_at <> old.created_at then
      raise exception 'Invitations cannot be edited. Revoke it and send a new one.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' and new.custom_role_id is not null then
    select * into cr from public.custom_roles where id = new.custom_role_id;
    if not found or cr.organization_id <> new.organization_id then
      raise exception 'That role does not belong to this organization' using errcode = '23503';
    end if;
    new.role := cr.base_role;
  end if;

  if actor is not null then
    actor_role := (public.current_membership(new.organization_id)).role;
    if actor_role is null then
      raise exception 'Not a member of this organization' using errcode = '42501';
    end if;
    if actor_role <> 'owner' and new.role = 'admin' then
      raise exception 'Only the owner can invite administrators' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' then
      new.invited_by := actor;
      if new.status <> 'pending' or new.accepted_by is not null or new.accepted_at is not null
         or new.membership_id is not null or new.revoked_by is not null or new.revoked_at is not null then
        raise exception 'New invitations start as pending' using errcode = '42501';
      end if;
      if actor_role <> 'owner' and public.has_permission(new.organization_id, 'members.manage') then
        perform public.assert_holds_permissions(
          new.organization_id,
          public.role_permission_keys(new.organization_id, new.role, new.custom_role_id),
          'You cannot invite someone with this role');
      end if;
    else
      if old.status in ('accepted', 'revoked') then
        raise exception 'This invitation is closed. Send a new one instead.' using errcode = '42501';
      end if;
      if new.status = 'accepted' or new.accepted_by is distinct from old.accepted_by
         or new.accepted_at is distinct from old.accepted_at or new.membership_id is distinct from old.membership_id then
        raise exception 'Only the invited person can accept an invitation' using errcode = '42501';
      end if;
      if new.status = 'revoked' and old.status <> 'revoked' then
        new.revoked_by := actor;
        new.revoked_at := now();
      elsif new.revoked_by is distinct from old.revoked_by or new.revoked_at is distinct from old.revoked_at then
        raise exception 'Revocation details are set automatically' using errcode = '42501';
      end if;
      if old.status = 'expired' and new.status = 'pending' and new.token_hash = old.token_hash then
        raise exception 'Resending needs a new link' using errcode = '42501';
      end if;
    end if;

    if new.status = 'pending' and (new.expires_at <= now() or new.expires_at > now() + interval '30 days') then
      raise exception 'Invitations must expire within 30 days' using errcode = '22023';
    end if;
  end if;

  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    if exists (
      select 1 from public.organization_memberships m
      join public.user_profiles p on p.id = m.user_id
      where m.organization_id = new.organization_id and lower(p.email) = new.email
    ) then
      raise exception 'This person is already a member of the team' using errcode = '23505';
    end if;
    update public.team_invitations
       set status = 'expired'
     where organization_id = new.organization_id and email = new.email
       and status = 'pending' and expires_at <= now() and id <> new.id;
  end if;

  return new;
end;
$$;

-- Accepting gives the invitation's custom role as well.
create or replace function public.accept_team_invitation(p_token_hash text, p_user_id uuid, p_full_name text default null)
returns table (result text, organization_id uuid, membership_id uuid, role public.member_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.team_invitations;
  user_email text;
  mem public.organization_memberships;
  new_member uuid;
begin
  select * into inv from public.team_invitations i where i.token_hash = p_token_hash for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::public.member_role;
    return;
  end if;
  if inv.status <> 'pending' then
    return query select (case inv.status when 'accepted' then 'used' else inv.status end)::text, inv.organization_id, null::uuid, inv.role;
    return;
  end if;
  if inv.expires_at <= now() then
    update public.team_invitations set status = 'expired' where id = inv.id;
    return query select 'expired'::text, inv.organization_id, null::uuid, inv.role;
    return;
  end if;

  select lower(p.email) into user_email from public.user_profiles p where p.id = p_user_id;
  if user_email is null or user_email <> inv.email then
    return query select 'email_mismatch'::text, inv.organization_id, null::uuid, inv.role;
    return;
  end if;

  if nullif(btrim(coalesce(p_full_name, '')), '') is not null then
    update public.user_profiles set full_name = left(btrim(p_full_name), 120) where id = p_user_id;
  end if;

  select * into mem from public.organization_memberships m
   where m.organization_id = inv.organization_id and m.user_id = p_user_id;

  if found and mem.status <> 'invited' then
    update public.team_invitations
       set status = 'accepted', accepted_by = p_user_id, accepted_at = now(), membership_id = mem.id
     where id = inv.id;
    return query select 'already_member'::text, inv.organization_id, mem.id, mem.role;
    return;
  elsif found then
    update public.organization_memberships
       set status = 'active', role = inv.role, custom_role_id = inv.custom_role_id
     where id = mem.id;
    new_member := mem.id;
  else
    insert into public.organization_memberships (organization_id, user_id, role, custom_role_id, status)
    values (inv.organization_id, p_user_id, inv.role, inv.custom_role_id, 'active')
    returning id into new_member;
  end if;

  update public.team_invitations
     set status = 'accepted', accepted_by = p_user_id, accepted_at = now(), membership_id = new_member
   where id = inv.id;

  return query select 'ok'::text, inv.organization_id, new_member, inv.role;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------

alter table public.organization_role_permissions enable row level security;
alter table public.custom_roles enable row level security;
alter table public.custom_role_permissions enable row level security;

-- Role names are shown next to people across the app; members may read them.
drop policy if exists "members read custom roles" on public.custom_roles;
create policy "members read custom roles" on public.custom_roles for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "role and member managers read custom role permissions" on public.custom_role_permissions;
create policy "role and member managers read custom role permissions" on public.custom_role_permissions for select to authenticated
  using (exists (
    select 1 from public.custom_roles cr
    where cr.id = role_id
      and (public.has_permission(cr.organization_id, 'roles.manage') or public.has_permission(cr.organization_id, 'members.manage'))
  ));

drop policy if exists "role and member managers read organization role permissions" on public.organization_role_permissions;
create policy "role and member managers read organization role permissions" on public.organization_role_permissions for select to authenticated
  using (public.has_permission(organization_id, 'roles.manage') or public.has_permission(organization_id, 'members.manage'));

revoke all on public.organization_role_permissions, public.custom_roles, public.custom_role_permissions from anon, authenticated;
grant select on public.organization_role_permissions, public.custom_roles, public.custom_role_permissions to authenticated;
grant all on public.organization_role_permissions, public.custom_roles, public.custom_role_permissions to service_role;

-- New column on existing tables: app users may set it where they set the role.
grant insert (organization_id, email, full_name, phone, role, token_hash, expires_at, custom_role_id)
  on public.team_invitations to authenticated;
grant select (custom_role_id) on public.team_invitations to authenticated;

-- Function grants (one by one; see the conventions in the first migration).
revoke execute on function public.role_grants(uuid, public.member_role, uuid, text) from public, anon, authenticated;
revoke execute on function public.role_permission_keys(uuid, public.member_role, uuid) from public, anon, authenticated;
revoke execute on function public.membership_permission(public.organization_memberships, text) from public, anon, authenticated;
revoke execute on function public.has_permission(uuid, text) from public, anon, authenticated;
revoke execute on function public.is_org_owner(uuid) from public, anon, authenticated;
revoke execute on function public.assert_holds_permissions(uuid, text[], text) from public, anon, authenticated;
revoke execute on function public.get_my_access_v2() from public, anon, authenticated;
revoke execute on function public.list_candidate_owners(uuid) from public, anon, authenticated;
revoke execute on function public.clean_permission_list(text[]) from public, anon, authenticated;
revoke execute on function public.assert_can_manage_roles(uuid, public.member_role) from public, anon, authenticated;
revoke execute on function public.create_custom_role(uuid, text, text, public.member_role, text[]) from public, anon, authenticated;
revoke execute on function public.update_custom_role(uuid, text, text, text[]) from public, anon, authenticated;
revoke execute on function public.delete_custom_role(uuid) from public, anon, authenticated;
revoke execute on function public.set_builtin_role_permissions(uuid, public.member_role, text[]) from public, anon, authenticated;
revoke execute on function public.reset_builtin_role_permissions(uuid, public.member_role) from public, anon, authenticated;
revoke execute on function public.membership_custom_role_rules() from public, anon, authenticated;
revoke execute on function public.audit_membership_role_change() from public, anon, authenticated;
revoke execute on function public.team_invitations_rules() from public, anon, authenticated;
revoke execute on function public.accept_team_invitation(text, uuid, text) from public, anon, authenticated;

grant execute on function public.has_permission(uuid, text) to authenticated, service_role;
grant execute on function public.get_my_access_v2() to authenticated, service_role;
grant execute on function public.list_candidate_owners(uuid) to authenticated, service_role;
grant execute on function public.role_permission_keys(uuid, public.member_role, uuid) to service_role;
grant execute on function public.create_custom_role(uuid, text, text, public.member_role, text[]) to authenticated, service_role;
grant execute on function public.update_custom_role(uuid, text, text, text[]) to authenticated, service_role;
grant execute on function public.delete_custom_role(uuid) to authenticated, service_role;
grant execute on function public.set_builtin_role_permissions(uuid, public.member_role, text[]) to authenticated, service_role;
grant execute on function public.reset_builtin_role_permissions(uuid, public.member_role) to authenticated, service_role;
grant execute on function public.accept_team_invitation(text, uuid, text) to service_role;


-- >>>>>>>>>>>>>>>>>>>> 20261014000015_course_cover_paths.sql

-- =============================================================================
-- Adrenaline Rush: built-in course covers
--   Course covers may now also point at the images shipped with the site in
--   public/covers (for example /covers/html-css.svg), so a course has a good
--   cover without hosting an image elsewhere. Any other value must still be a
--   full https:// link.
-- =============================================================================

alter table public.courses drop constraint if exists courses_cover_image_url_check;
alter table public.courses add constraint courses_cover_image_url_check check (
  cover_image_url is null
  or cover_image_url ~* '^https://'
  or cover_image_url ~ '^/covers/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(svg|png|jpg|jpeg|webp)$'
);
