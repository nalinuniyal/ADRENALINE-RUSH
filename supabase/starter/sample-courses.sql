-- =============================================================================
-- SAMPLE COURSES (optional)
--
-- Adds four sample courses, each with a category, "What's included" items,
-- FAQs, a curriculum and the standard demo-booking form:
--   /courses/mcp                          Marketing Cloud Personalization (MCP)
--   /courses/marketing-cloud-engagement   Marketing Cloud Engagement
--   /courses/data-cloud                   Salesforce Data Cloud
--   /courses/html-css                     HTML & CSS for Marketers
--
-- All text and prices are SAMPLES: change them in Admin › Courses or directly
-- in Supabase › Table Editor › courses before you share links.
--
-- How to use: run supabase/setup.sql first and create your admin login
-- (npm run admin:password), then Supabase › SQL Editor › paste this file › Run.
--
-- Safe to run again: a course whose slug already exists is skipped (your
-- edits are never overwritten). To start a sample again, delete that course
-- (Admin › Courses › Delete) and re-run.
--
-- Want them hidden until you are ready? Change publish_now below to false.
-- =============================================================================

do $$
declare
  publish_now boolean := true;

  org uuid := public.primary_organization_id();
  c jsonb;
  m jsonb;
  l jsonb;
  cat_id uuid;
  v_course uuid;
  mod_id uuid;
  m_pos integer;
  l_pos integer;
  created text[] := '{}';
  skipped text[] := '{}';
  std_inclusions jsonb := $json$[
    {"title": "Interview practice", "description": "Mock interviews with feedback on real questions for this role.", "icon": "mic"},
    {"title": "Interview & placement support", "description": "Resume and LinkedIn review, interview preparation and guidance while you apply.", "icon": "handshake"},
    {"title": "One-to-one discussions", "description": "Personal sessions with the trainer to clear doubts and plan your path.", "icon": "messages-square"},
    {"title": "Real-life hands-on projects", "description": "Build and configure real scenarios, not just slides.", "icon": "hammer"},
    {"title": "Post-course development support", "description": "Help with questions from your job or project after the course ends.", "icon": "life-buoy"}
  ]$json$::jsonb;
  std_faqs jsonb := $json$[
    {"q": "Is the demo class free?", "a": "Yes. Book a free demo, meet the trainer and see how the classes run before you decide."},
    {"q": "Are classes live or recorded?", "a": "Classes are live online. Recordings are shared after each session so you can revise."},
    {"q": "Do I get support after the course?", "a": "Yes. You can reach the trainer for questions from your job or project after the course ends."}
  ]$json$::jsonb;
  courses jsonb := $json$[
    {
      "slug": "mcp",
      "title": "Salesforce Marketing Cloud Personalization (MCP)",
      "category": ["salesforce-marketing-cloud", "Salesforce Marketing Cloud", "Marketing Cloud products and personalization."],
      "short_description": "Live, hands-on MCP training: real-time web personalization, segments, campaigns and Einstein recommendations.",
      "description": "Learn to implement and run Salesforce Marketing Cloud Personalization (formerly Interaction Studio): set up the Web SDK and sitemap, model your catalog, build segments, launch web, server-side and triggered campaigns, configure Einstein recommendations and measure results with A/B tests. The course ends with a real-life project and interview preparation.",
      "who_is_it_for": "Marketing Cloud developers and consultants, Salesforce professionals moving into personalization, and digital marketers who want hands-on MCP skills.",
      "prerequisites": "Basic web knowledge (HTML, CSS, JavaScript) helps. Salesforce experience is useful but not required.",
      "outcomes": ["Explain how MCP collects data and makes real-time decisions", "Deploy the Web SDK and build a sitemap", "Build segments and web, server-side and triggered campaigns", "Configure recipes and Einstein recommendations", "Measure results with A/B tests and reports"],
      "level": "Intermediate", "duration": "6 weeks · weekends", "list_price": 30000, "discounted_price": 24999, "show_price": true,
      "badge": "Next free demo: Saturday 11 AM", "cta": "Book a free demo",
      "modules": [
        ["Platform overview", ["Real-time personalization concepts", "Datasets, environments and roles", "Visitor profiles and identity", "Tour of the MCP interface"]],
        ["Web SDK and sitemap", ["Deploying the Web SDK", "Page types and content zones", "Capturing identity and attributes", "Debugging the sitemap"]],
        ["Catalog and data", ["Catalog objects and dimensions", "Profile and catalog data feeds", "Identity resolution basics"]],
        ["Segments and campaigns", ["Rule-based segments", "Web campaigns and templates", "Server-side and triggered campaigns"]],
        ["Recipes and Einstein", ["Recipe ingredients, exclusions and boosters", "Einstein recommendations", "Recommendations in web and email"]],
        ["Testing and analytics", ["A/B tests and control groups", "Campaign statistics and reports"]],
        ["Real-life project", ["Solution design", "Implementation on a sample site", "Go-live checklist"]],
        ["Interview preparation", ["Common MCP interview questions", "Scenario-based questions", "Mock interview"]]
      ]
    },
    {
      "slug": "marketing-cloud-engagement",
      "title": "Salesforce Marketing Cloud Engagement",
      "category": ["salesforce-marketing-cloud", "Salesforce Marketing Cloud", "Marketing Cloud products and personalization."],
      "short_description": "Email Studio, Journey Builder, Automation Studio, SQL and AMPscript, taught live with real projects.",
      "description": "Become job-ready on Salesforce Marketing Cloud Engagement: build emails and content, manage subscribers and data extensions, write SQL queries and AMPscript, automate with Automation Studio and design customer journeys in Journey Builder.",
      "who_is_it_for": "Email marketers, Salesforce admins and developers, and freshers who want to start a Marketing Cloud career.",
      "prerequisites": "Comfort with computers and basic HTML. No Salesforce experience needed.",
      "outcomes": ["Build and send emails with Content Builder", "Model data with data extensions and relationships", "Write SQL queries and AMPscript", "Automate data and sends with Automation Studio", "Design multi-step journeys in Journey Builder"],
      "level": "Beginner to intermediate", "duration": "8 weeks · weekends", "list_price": null, "discounted_price": null, "show_price": false,
      "badge": "New batch starting soon", "cta": "Book a free demo",
      "modules": [
        ["Marketing Cloud basics", ["Studios and builders overview", "Business units, users and roles", "Setup essentials"]],
        ["Email Studio and Content Builder", ["Templates and content blocks", "Personalization strings", "Testing and sending"]],
        ["Data", ["Subscribers and lists", "Data extensions and relationships", "Contact Builder and data designer"]],
        ["SQL and AMPscript", ["SQL query activities", "AMPscript basics", "Dynamic content"]],
        ["Automation Studio", ["Imports, queries and extracts", "Scheduled and triggered automations"]],
        ["Journey Builder", ["Entry sources and events", "Decision splits and waits", "Journey analytics"]],
        ["Real-life project and interview preparation", ["End-to-end campaign project", "Interview questions and mock interview"]]
      ]
    },
    {
      "slug": "data-cloud",
      "title": "Salesforce Data Cloud",
      "category": ["salesforce-data-cloud", "Salesforce Data Cloud", "Customer data platform skills on Salesforce."],
      "short_description": "Unify customer data: ingestion, data model mapping, identity resolution, calculated insights and segmentation.",
      "description": "Learn Salesforce Data Cloud end to end: connect data sources, map to the data model, set up identity resolution, build calculated insights and segments, and activate audiences to Marketing Cloud and other channels.",
      "who_is_it_for": "Salesforce and Marketing Cloud professionals who want to add Data Cloud, and data or analytics people moving into the Salesforce ecosystem.",
      "prerequisites": "Salesforce basics. Some SQL helps.",
      "outcomes": ["Ingest data from Salesforce and external sources", "Map data streams to the data model", "Configure identity resolution", "Build calculated insights and segments", "Activate audiences to channels"],
      "level": "Intermediate", "duration": "5 weeks · weekends", "list_price": null, "discounted_price": null, "show_price": false,
      "badge": null, "cta": "Book a free demo",
      "modules": [
        ["Data Cloud overview", ["What a CDP does", "Data Cloud architecture", "Licences and setup"]],
        ["Ingestion", ["Data streams and connectors", "Salesforce CRM and Marketing Cloud sources", "Files and cloud storage"]],
        ["Data model", ["Data lake and data model objects", "Mapping and relationships"]],
        ["Identity resolution", ["Match and reconciliation rules", "Unified profiles"]],
        ["Insights and segments", ["Calculated and streaming insights", "Segmentation"]],
        ["Activation and project", ["Activation targets", "End-to-end project", "Interview preparation"]]
      ]
    },
    {
      "slug": "html-css",
      "title": "HTML & CSS for Marketers",
      "category": ["web-development", "Web development", "HTML, CSS and front-end skills."],
      "short_description": "Build responsive web pages and email templates from scratch with HTML and CSS.",
      "description": "A practical HTML and CSS course for marketers and Marketing Cloud learners: page structure, styling, Flexbox and Grid, responsive design and building email templates that work across inboxes.",
      "who_is_it_for": "Marketers, Marketing Cloud learners and anyone starting with web development.",
      "prerequisites": "None.",
      "outcomes": ["Write clean, semantic HTML", "Style pages with CSS, Flexbox and Grid", "Make pages responsive for phones", "Build email-safe HTML templates"],
      "level": "Beginner", "duration": "3 weeks · weekdays", "list_price": 8000, "discounted_price": 5999, "show_price": true,
      "badge": null, "cta": "Book a free demo",
      "modules": [
        ["HTML basics", ["Tags, attributes and page structure", "Text, links, images and lists", "Forms and tables"]],
        ["CSS basics", ["Selectors, colours and fonts", "The box model", "Classes and reusable styles"]],
        ["Layouts", ["Flexbox", "CSS Grid"]],
        ["Responsive design", ["Media queries", "Mobile-first pages"]],
        ["Email HTML", ["Table-based email layouts", "Inline styles and testing"]],
        ["Project", ["Build and publish a landing page", "Build a responsive email template"]]
      ]
    }
  ]$json$::jsonb;
begin
  if org is null then
    raise notice 'No business yet: create your admin login first (npm run admin:password), then run this again.';
    return;
  end if;

  for c in select value from jsonb_array_elements(courses) loop
    if exists (select 1 from public.courses where organization_id = org and slug = c ->> 'slug') then
      skipped := skipped || (c ->> 'slug');
      continue;
    end if;

    insert into public.course_categories (organization_id, name, slug, description)
    values (org, c #>> '{category,1}', c #>> '{category,0}', c #>> '{category,2}')
    on conflict (organization_id, slug) do nothing;
    select id into cat_id from public.course_categories where organization_id = org and slug = c #>> '{category,0}';

    insert into public.courses (
      organization_id, category_id, title, slug, short_description, description, who_is_it_for,
      prerequisites, learning_outcomes, level, duration_text, delivery_mode,
      list_price, discounted_price, show_price, status, registration_mode,
      highlight_badge, cta_label, inclusions, faqs
    ) values (
      org, cat_id, c ->> 'title', c ->> 'slug', c ->> 'short_description', c ->> 'description', c ->> 'who_is_it_for',
      c ->> 'prerequisites', array(select jsonb_array_elements_text(c -> 'outcomes')), c ->> 'level', c ->> 'duration', 'online',
      (c ->> 'list_price')::numeric, (c ->> 'discounted_price')::numeric, (c ->> 'show_price')::boolean,
      (case when publish_now then 'published' else 'draft' end)::public.course_status, 'demo',
      c ->> 'badge', c ->> 'cta', std_inclusions, std_faqs
    ) returning id into v_course;

    m_pos := 0;
    for m in select value from jsonb_array_elements(c -> 'modules') loop
      m_pos := m_pos + 10;
      insert into public.course_modules (course_id, title, position)
      values (v_course, m ->> 0, m_pos) returning id into mod_id;
      l_pos := 0;
      for l in select value from jsonb_array_elements(m -> 1) loop
        l_pos := l_pos + 10;
        insert into public.lessons (module_id, title, position) values (mod_id, l #>> '{}', l_pos);
      end loop;
    end loop;
    created := created || (c ->> 'slug');
  end loop;

  raise notice 'Created: %. Skipped (already existed): %.',
    coalesce(nullif(array_to_string(created, ', '), ''), 'none'),
    coalesce(nullif(array_to_string(skipped, ', '), ''), 'none');
end $$;
