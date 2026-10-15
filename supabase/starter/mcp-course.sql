-- =============================================================================
-- OPTIONAL STARTER CONTENT: "Salesforce Marketing Cloud Personalization (MCP)"
--
-- Creates a DRAFT course with slug "mcp" (category "Salesforce Marketing
-- Cloud"), a free-demo registration form, the five suggested "What's included"
-- items and a starter curriculum outline. Nothing is published: review and
-- edit everything under Admin › Courses, then publish.
--
-- How to use: run supabase/setup.sql first and create your owner account at
-- /setup, then Supabase dashboard -> SQL Editor -> paste this file -> Run.
--
-- Safe to run again: it does nothing if a course with slug "mcp" exists.
-- =============================================================================

do $$
declare
  org uuid := public.primary_organization_id();
  cat_id uuid;
  v_course uuid;
  mod_id uuid;
  m jsonb;
  l jsonb;
  m_pos integer := 0;
  l_pos integer;
  modules jsonb := $json$[
    {"title": "Platform overview and architecture",
     "description": "What Marketing Cloud Personalization (formerly Interaction Studio) does and how it fits in the Salesforce stack.",
     "lessons": ["Real-time personalization concepts and use cases", "Datasets, environments and user roles", "Visitor profiles, identities and the event pipeline", "Tour of the MCP user interface"]},
    {"title": "Web integration: Web SDK and sitemap",
     "description": "Collecting behaviour on a website.",
     "lessons": ["Deploying the Web SDK (beacon) on a site", "Sitemap basics: page types and global settings", "Content zones and actions", "Capturing user identity and attributes", "Debugging the sitemap with browser tools"]},
    {"title": "Catalog and data",
     "description": "Products, content and the data that powers decisions.",
     "lessons": ["Catalog objects: products, articles, blogs and categories", "Related catalog objects and dimensions", "Profile and catalog data feeds (ETL)", "Data hygiene and identity resolution basics"]},
    {"title": "Segments",
     "description": "Grouping visitors to target the right experience.",
     "lessons": ["Building rule-based segments", "Real-time vs. batch segment membership", "Using segments in campaigns and reports"]},
    {"title": "Campaigns: web, server-side and triggered",
     "description": "Delivering personalized experiences across channels.",
     "lessons": ["Web campaigns and templates", "Campaign targeting rules and experiences", "Server-side campaigns for apps and APIs", "Triggered campaigns (e.g. cart or browse abandonment)", "Open-time email content campaigns"]},
    {"title": "Recipes and Einstein recommendations",
     "description": "Choosing what to recommend to each visitor.",
     "lessons": ["Recipe ingredients (e.g. co-browse, co-buy, trending)", "Exclusions, boosters and variations", "Einstein-driven recommendations and decisions", "Placing recommendations in web and email campaigns"]},
    {"title": "Testing and analytics",
     "description": "Proving what works.",
     "lessons": ["A/B tests and control groups", "Reading campaign statistics and confidence", "Dashboards and reports", "Troubleshooting campaigns that do not render"]},
    {"title": "Integrations with Marketing Cloud and Data Cloud",
     "description": "Connecting MCP to the rest of the platform.",
     "lessons": ["Marketing Cloud Engagement integration (email and journeys)", "Data Cloud integration overview", "APIs and other common connectors"]},
    {"title": "Real-life project",
     "description": "An end-to-end implementation on a sample site.",
     "lessons": ["Requirements and solution design", "Sitemap and catalog implementation", "Segments, campaigns and recommendations", "Testing, go-live checklist and handover"]},
    {"title": "Interview and career preparation",
     "description": "Getting ready for MCP roles.",
     "lessons": ["Common MCP interview questions", "Scenario-based design questions", "Resume and LinkedIn profile review", "Mock interview"]}
  ]$json$::jsonb;
begin
  if org is null then
    raise notice 'No organization yet: open /setup to create the owner account, then run this script again.';
    return;
  end if;
  if exists (select 1 from public.courses where organization_id = org and slug = 'mcp') then
    raise notice 'A course with slug "mcp" already exists; nothing was changed.';
    return;
  end if;

  insert into public.course_categories (organization_id, name, slug, description)
  values (org, 'Salesforce Marketing Cloud', 'salesforce-marketing-cloud', 'Marketing Cloud products and personalization.')
  on conflict (organization_id, slug) do nothing;
  select id into cat_id from public.course_categories where organization_id = org and slug = 'salesforce-marketing-cloud';

  insert into public.courses (
    organization_id, category_id, title, slug, short_description, description, who_is_it_for,
    prerequisites, learning_outcomes, level, delivery_mode, list_price, discounted_price, show_price,
    status, registration_mode, inclusions, faqs
  ) values (
    org, cat_id,
    'Salesforce Marketing Cloud Personalization (MCP)',
    'mcp',
    'Hands-on, live training in Salesforce Marketing Cloud Personalization: real-time web personalization, segments, campaigns and Einstein recommendations.',
    E'STARTER OUTLINE — review and edit before publishing.\n\n'
      'Learn to implement and run Salesforce Marketing Cloud Personalization (formerly Interaction Studio): '
      'set up the Web SDK and sitemap, model your catalog, build segments, launch web, server-side and triggered campaigns, '
      'configure Einstein recommendations and measure results with A/B tests. The course ends with a real-life project and interview preparation.',
    'Marketing Cloud developers and consultants, Salesforce professionals moving into personalization, and digital marketers who want hands-on MCP skills.',
    'Basic web knowledge (HTML, CSS, JavaScript) helps. Familiarity with Salesforce or Marketing Cloud is useful but not required.',
    array[
      'Explain how Marketing Cloud Personalization collects data and makes real-time decisions',
      'Deploy the Web SDK and build a sitemap for a website',
      'Model catalog and profile data',
      'Build segments and web, server-side and triggered campaigns',
      'Configure recipes and Einstein recommendations',
      'Measure campaigns with A/B tests and reports'
    ],
    'Intermediate', 'online', null, null, false,
    'draft', 'demo',
    $json$[
      {"title": "Interview practice", "description": "Mock interviews with feedback on real questions for this role.", "icon": "mic"},
      {"title": "Interview & placement support", "description": "Resume and LinkedIn review, interview preparation and guidance while you apply.", "icon": "handshake"},
      {"title": "One-to-one discussions", "description": "Personal sessions with the trainer to clear doubts and plan your path.", "icon": "messages-square"},
      {"title": "Real-life hands-on projects", "description": "Build and configure real scenarios, not just slides.", "icon": "hammer"},
      {"title": "Post-course development support", "description": "Help with questions from your job or project after the course ends.", "icon": "life-buoy"}
    ]$json$::jsonb,
    '[]'::jsonb
  ) returning id into v_course;

  for m in select value from jsonb_array_elements(modules) loop
    m_pos := m_pos + 10;
    insert into public.course_modules (course_id, title, description, position)
    values (v_course, m ->> 'title', m ->> 'description', m_pos)
    returning id into mod_id;
    l_pos := 0;
    for l in select value from jsonb_array_elements(m -> 'lessons') loop
      l_pos := l_pos + 10;
      insert into public.lessons (module_id, title, position) values (mod_id, l #>> '{}', l_pos);
    end loop;
  end loop;

  raise notice 'Created the draft course "Salesforce Marketing Cloud Personalization (MCP)" at /courses/mcp. Review it in Admin › Courses, then publish.';
end $$;
