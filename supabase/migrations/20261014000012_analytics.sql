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
