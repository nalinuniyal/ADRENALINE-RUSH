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
