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
