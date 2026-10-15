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
