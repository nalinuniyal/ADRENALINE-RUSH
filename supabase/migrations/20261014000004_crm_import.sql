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
