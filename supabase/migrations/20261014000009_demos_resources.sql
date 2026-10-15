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
