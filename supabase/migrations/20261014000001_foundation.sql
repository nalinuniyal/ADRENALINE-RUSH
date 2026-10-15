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
