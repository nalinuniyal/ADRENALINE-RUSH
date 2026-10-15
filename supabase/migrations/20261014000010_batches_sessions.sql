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
