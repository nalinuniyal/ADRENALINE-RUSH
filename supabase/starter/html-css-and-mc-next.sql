-- =============================================================================
-- Adrenaline Rush: "HTML & CSS" and "Salesforce Marketing Cloud Next" courses
--
-- Creates or refreshes two complete courses, built like the MCP course:
--   /courses/html-css               HTML & CSS for Marketers and Marketing Cloud
--   /courses/marketing-cloud-next   Salesforce Marketing Cloud Next
-- Each gets a detailed overview, who it is for, prerequisites, learning
-- outcomes, a full curriculum (modules and lessons with durations), the five
-- "What's included" items, FAQs, a certificate note and a cover image.
-- It also gives the MCP course its cover image if it has none yet.
--
-- How to use: Supabase > SQL Editor > New query > paste this whole file > Run.
-- Run the latest supabase/setup.sql first if you have not already.
--
-- Safe to run again:
--   * a course that does not exist yet is created (published, or a draft if
--     you set publish_now to false below);
--   * a course that already exists (for example the sample "html-css" course)
--     gets this text, inclusions, FAQs, cover and curriculum, but KEEPS its
--     status, prices, schedule, capacity, demo link, registration form and
--     every registration and candidate.
--
-- Cover images: /covers/html-css.svg, /covers/marketing-cloud-next.svg and
-- /covers/mcp.svg ship with the website (public/covers). They show once the
-- updated website is deployed. To use your own image instead, put a full
-- https:// image link in Admin > Courses > Edit > Cover image URL.
-- =============================================================================

-- Allow the built-in /covers/... images as course covers (same change as
-- migration 20261014000015; harmless if already applied).
alter table public.courses drop constraint if exists courses_cover_image_url_check;
alter table public.courses add constraint courses_cover_image_url_check check (
  cover_image_url is null
  or cover_image_url ~* '^https://'
  or cover_image_url ~ '^/covers/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(svg|png|jpg|jpeg|webp)$'
);

do $$
declare
  publish_now boolean := true;   -- false = new courses are created as drafts

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
  updated text[] := '{}';
  std_inclusions jsonb := $json$[
    {"title": "Interview practice", "description": "Mock interviews with feedback on real questions for this role.", "icon": "mic"},
    {"title": "Interview & placement support", "description": "Resume and LinkedIn review, interview preparation and guidance while you apply.", "icon": "handshake"},
    {"title": "One-to-one discussions", "description": "Personal sessions with the trainer to clear doubts and plan your path.", "icon": "messages-square"},
    {"title": "Real-life hands-on projects", "description": "Build and configure real scenarios, not just slides.", "icon": "hammer"},
    {"title": "Post-course development support", "description": "Help with questions from your job or project after the course ends.", "icon": "life-buoy"}
  ]$json$::jsonb;
  courses jsonb := $json$[
  {
    "slug": "html-css",
    "title": "HTML & CSS for Marketers and Marketing Cloud",
    "category": [
      "web-development",
      "Web development",
      "HTML, CSS and front-end skills for marketers and Salesforce professionals."
    ],
    "cover": "/covers/html-css.svg",
    "badge": "Beginner friendly",
    "cta": "Book a free demo",
    "level": "Beginner",
    "duration": "6 weeks · about 40 hours live",
    "short_description": "Learn HTML and CSS from zero: build responsive, accessible web pages and email templates that work in Marketing Cloud, Gmail and Outlook.",
    "description": "HTML and CSS are the building blocks of every web page, landing page and marketing email. This hands-on course takes you from your first tag to publishing a responsive landing page and a tested, inbox-ready email template, the exact skills Salesforce Marketing Cloud, Marketing Cloud Personalization (MCP) and Marketing Cloud Next projects expect.\n\nWhat you will learn\n• Semantic HTML: page structure, headings, text, links, images, lists, tables and forms written the way search engines and screen readers expect.\n• CSS from the ground up: selectors, the cascade and specificity, colours, typography, units, the box model and reusable classes.\n• Modern layout with Flexbox and CSS Grid, and when to use which.\n• Responsive, mobile-first design with media queries, fluid images and fluid type.\n• Accessibility basics: colour contrast, alt text, keyboard focus and form labels.\n• Email HTML: table-based layouts, inline styles, bulletproof buttons, dark mode, and the quirks of Gmail and Outlook.\n• Marketing Cloud ready content: HTML content blocks, editable regions, simple personalization placeholders and a reusable template structure you can bring into Content Builder or the Marketing Cloud Next email builder.\n• Working like a developer: VS Code, browser DevTools, Git and GitHub, and free hosting to publish your work.\n\nHow the course runs\nLive online classes with a short concept session followed by guided coding. Every module ends with an exercise, and the course ends with two portfolio projects: a responsive campaign landing page and a responsive email template, both reviewed by the trainer.\n\nAfter the course\nYou will be able to read and fix the HTML and CSS in any landing page or email, build new ones from a design, and move confidently into Marketing Cloud, MCP or front-end courses.",
    "who_is_it_for": "Complete beginners who want to learn web basics properly.\nEmail marketers and campaign specialists who want to build and fix their own emails.\nSalesforce Marketing Cloud, MCP and Marketing Cloud Next learners who need HTML and CSS for content and templates.\nFreshers and career switchers preparing for marketing technology or front-end roles.",
    "prerequisites": "None. You need a laptop (Windows, Mac or Linux) with a modern browser and the free VS Code editor; we install everything together in the first class.",
    "outcomes": [
      "Write clean, semantic and accessible HTML for real pages",
      "Style pages with CSS: selectors, the cascade, typography and the box model",
      "Build layouts with Flexbox and CSS Grid",
      "Make any page responsive and mobile-first with media queries",
      "Build email templates that render well in Gmail, Outlook and Apple Mail",
      "Prepare HTML content blocks and templates for Salesforce Marketing Cloud",
      "Debug layouts with browser DevTools and fix common rendering problems",
      "Publish your work with Git, GitHub and free hosting"
    ],
    "certificate": "Certificate of completion from Adrenaline Rush after you finish both portfolio projects.",
    "faqs": [
      {
        "q": "I have never written code. Can I join?",
        "a": "Yes. The course starts from zero and every class includes guided practice. You only need a laptop and an internet connection."
      },
      {
        "q": "Will this help with Salesforce Marketing Cloud?",
        "a": "Yes. Email HTML, content blocks and templates are taught with Marketing Cloud in mind, so you can build and fix emails and landing pages in your projects."
      },
      {
        "q": "Do you teach JavaScript?",
        "a": "This course focuses on HTML and CSS. The final module gives a short preview of JavaScript so you know where to go next."
      },
      {
        "q": "Is the demo class free?",
        "a": "Yes. Book a free demo, meet the trainer and see how the classes run before you decide."
      },
      {
        "q": "Are classes live or recorded?",
        "a": "Classes are live online. Recordings are shared after each session so you can revise."
      },
      {
        "q": "Do I get support after the course?",
        "a": "Yes. You can reach the trainer for questions from your job or project after the course ends."
      }
    ],
    "modules": [
      {
        "title": "Getting started: how the web works",
        "description": "Set up your tools and understand what happens when a page loads.",
        "lessons": [
          {
            "title": "How browsers, servers and URLs work",
            "minutes": 30
          },
          {
            "title": "Installing VS Code, extensions and a live preview",
            "minutes": 30
          },
          {
            "title": "Your first HTML page and the document structure",
            "minutes": 45
          },
          {
            "title": "Using browser DevTools to inspect any page",
            "minutes": 45
          }
        ]
      },
      {
        "title": "HTML fundamentals",
        "description": "The core tags every page uses.",
        "lessons": [
          {
            "title": "Headings, paragraphs and text formatting",
            "minutes": 30
          },
          {
            "title": "Links: internal, external, email and phone",
            "minutes": 30
          },
          {
            "title": "Images, formats and alt text",
            "minutes": 30
          },
          {
            "title": "Lists and navigation menus",
            "minutes": 30
          },
          {
            "title": "Tables for data",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Semantic HTML and accessibility",
        "description": "Write pages that search engines and assistive technology understand.",
        "lessons": [
          {
            "title": "Semantic layout: header, nav, main, section, article, footer",
            "minutes": 40
          },
          {
            "title": "Accessibility basics: landmarks, alt text and focus order",
            "minutes": 40
          },
          {
            "title": "SEO essentials: titles, meta descriptions and Open Graph tags",
            "minutes": 30
          },
          {
            "title": "Validating HTML and fixing common mistakes",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Forms that convert",
        "description": "Build lead forms like the ones used on campaign landing pages.",
        "lessons": [
          {
            "title": "Inputs, labels, placeholders and buttons",
            "minutes": 40
          },
          {
            "title": "Choosing input types: email, tel, date, select and checkbox",
            "minutes": 30
          },
          {
            "title": "Built-in validation and helpful error messages",
            "minutes": 30
          },
          {
            "title": "Accessible, mobile-friendly form layout",
            "minutes": 30
          }
        ]
      },
      {
        "title": "CSS fundamentals",
        "description": "Make pages look good and keep styles reusable.",
        "lessons": [
          {
            "title": "Adding CSS: inline, internal and external stylesheets",
            "minutes": 30
          },
          {
            "title": "Selectors, the cascade, specificity and inheritance",
            "minutes": 45
          },
          {
            "title": "Colours, units and CSS variables",
            "minutes": 40
          },
          {
            "title": "Typography and web fonts",
            "minutes": 40
          },
          {
            "title": "Backgrounds, borders and shadows",
            "minutes": 30
          }
        ]
      },
      {
        "title": "The box model and positioning",
        "description": "Control spacing and placement precisely.",
        "lessons": [
          {
            "title": "Margin, border, padding and box-sizing",
            "minutes": 40
          },
          {
            "title": "Display: block, inline and inline-block",
            "minutes": 30
          },
          {
            "title": "Positioning: relative, absolute, fixed and sticky",
            "minutes": 45
          },
          {
            "title": "Overflow, z-index and stacking",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Flexbox",
        "description": "One-dimensional layouts for navbars, cards and alignment.",
        "lessons": [
          {
            "title": "Flex containers, direction and wrapping",
            "minutes": 40
          },
          {
            "title": "Alignment and spacing with justify-content, align-items and gap",
            "minutes": 40
          },
          {
            "title": "Flexible sizing with flex-grow, flex-shrink and flex-basis",
            "minutes": 30
          },
          {
            "title": "Practice: navbar, hero and card row",
            "minutes": 50
          }
        ]
      },
      {
        "title": "CSS Grid",
        "description": "Two-dimensional page layouts.",
        "lessons": [
          {
            "title": "Grid containers, tracks and the fr unit",
            "minutes": 40
          },
          {
            "title": "Placing items and named grid areas",
            "minutes": 40
          },
          {
            "title": "Responsive grids with repeat, auto-fit and minmax",
            "minutes": 40
          },
          {
            "title": "Choosing between Flexbox and Grid",
            "minutes": 20
          }
        ]
      },
      {
        "title": "Responsive, mobile-first design",
        "description": "Pages that look right on every screen.",
        "lessons": [
          {
            "title": "Viewport, mobile-first thinking and breakpoints",
            "minutes": 30
          },
          {
            "title": "Media queries in practice",
            "minutes": 45
          },
          {
            "title": "Fluid images, responsive type and clamp()",
            "minutes": 40
          },
          {
            "title": "Testing on real devices and in DevTools device mode",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Polish: effects and animation",
        "description": "Small touches that make a page feel professional.",
        "lessons": [
          {
            "title": "Pseudo-classes and pseudo-elements",
            "minutes": 30
          },
          {
            "title": "Transitions and hover states",
            "minutes": 30
          },
          {
            "title": "Transforms and keyframe animations",
            "minutes": 40
          },
          {
            "title": "Performance and reduced-motion preferences",
            "minutes": 20
          }
        ]
      },
      {
        "title": "HTML email development",
        "description": "Emails that render in Gmail, Outlook and Apple Mail.",
        "lessons": [
          {
            "title": "Why email HTML is different: email clients and their limits",
            "minutes": 30
          },
          {
            "title": "Table-based, responsive email layouts",
            "minutes": 60
          },
          {
            "title": "Inline styles, web-safe fonts and images",
            "minutes": 40
          },
          {
            "title": "Bulletproof buttons, dark mode and Outlook fixes",
            "minutes": 45
          },
          {
            "title": "Testing, previews and spam-friendly practices",
            "minutes": 30
          }
        ]
      },
      {
        "title": "HTML for Salesforce Marketing Cloud",
        "description": "Bring your HTML into real marketing platforms.",
        "lessons": [
          {
            "title": "Content blocks, templates and editable regions",
            "minutes": 45
          },
          {
            "title": "Personalization placeholders and dynamic content basics",
            "minutes": 40
          },
          {
            "title": "Building a reusable branded template",
            "minutes": 45
          },
          {
            "title": "Landing pages and forms on Marketing Cloud",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Tools of the trade and publishing",
        "description": "Work like a professional developer.",
        "lessons": [
          {
            "title": "Git and GitHub basics",
            "minutes": 45
          },
          {
            "title": "Publishing a site free on GitHub Pages or Vercel",
            "minutes": 30
          },
          {
            "title": "Organising CSS: naming conventions and reusable components",
            "minutes": 30
          },
          {
            "title": "A short preview of JavaScript and what to learn next",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Portfolio projects and career preparation",
        "description": "Two reviewed projects and interview readiness.",
        "lessons": [
          {
            "title": "Project 1: responsive campaign landing page",
            "minutes": 120
          },
          {
            "title": "Project 2: responsive email template",
            "minutes": 120
          },
          {
            "title": "Code review and feedback session",
            "minutes": 45
          },
          {
            "title": "HTML and CSS interview questions and portfolio review",
            "minutes": 60
          }
        ]
      }
    ]
  },
  {
    "slug": "marketing-cloud-next",
    "title": "Salesforce Marketing Cloud Next",
    "category": [
      "salesforce-marketing-cloud",
      "Salesforce Marketing Cloud",
      "Marketing Cloud products and personalization."
    ],
    "cover": "/covers/marketing-cloud-next.svg",
    "badge": "New: Agentforce for Marketing",
    "cta": "Book a free demo",
    "level": "Intermediate",
    "duration": "7 weeks · about 42 hours live",
    "short_description": "Hands-on training in Salesforce Marketing Cloud Next: Data Cloud segments, Flow-based journeys, email, SMS and WhatsApp, consent, personalization and Agentforce for marketing.",
    "description": "Marketing Cloud Next is Salesforce's newest marketing platform. It runs on the core Salesforce platform with Data Cloud (Data 360) and Agentforce built in, so marketing, sales and service share one customer profile, one consent model and one set of AI agents. This course teaches you to set it up and run real campaigns on it, end to end.\n\nWhat you will learn\n• Where Marketing Cloud Next fits: how it compares with Marketing Cloud Engagement, Account Engagement (Pardot) and MCP, and the editions and add-ons you will meet on projects.\n• Setting up the platform: business units, users and permission sets, sender domains, branding and channel configuration.\n• Data Cloud foundations: data streams, data model objects, identity resolution, unified profiles, calculated insights and data spaces.\n• Segmentation and activation: building segments on unified data, waterfall and nested segments, and activating them to marketing.\n• Content: the email builder, reusable content and templates, brand settings, SMS and WhatsApp messages, forms and landing pages.\n• Journeys with Flow: entry criteria, waits, decision splits, channel steps, engagement-based paths, testing and debugging.\n• Consent and compliance: communication subscriptions, preference centres, unsubscribe handling and data-privacy basics (including India's DPDP Act and GDPR).\n• Personalization: merge fields, dynamic content, product and content recommendations, and how it connects to Personalization (MCP).\n• Agentforce for marketing: using AI agents to draft campaign briefs, create segments, generate and refine content and build journeys, with guardrails and human review.\n• Analytics: engagement metrics, campaign dashboards, attribution basics and A/B testing.\n• Migration and integration: moving from Marketing Cloud Engagement or Account Engagement, plus connecting Sales Cloud, Service Cloud and Commerce data.\n\nHow the course runs\nLive online classes on a Salesforce org, with a demo, a guided build and a hands-on exercise in every module. You finish with a real-life project, an end-to-end customer lifecycle programme from data to journey to reporting, plus interview and certification preparation.\n\nNote: Salesforce updates Marketing Cloud Next in every release (three a year). The course is updated to the current release, and feature names or availability can differ by edition and licence.",
    "who_is_it_for": "Marketing Cloud Engagement and Account Engagement (Pardot) professionals moving to Marketing Cloud Next.\nSalesforce admins, developers and consultants adding marketing skills.\nMCP and Data Cloud learners who want to run campaigns on unified data.\nDigital and email marketers who want hands-on Salesforce marketing automation and AI skills.",
    "prerequisites": "Basic Salesforce knowledge (objects, records, users and permissions) is recommended; Trailhead's Admin Beginner trail is enough. HTML and CSS basics help for email content (see our HTML & CSS course). No coding is required.",
    "outcomes": [
      "Explain the Marketing Cloud Next architecture on Salesforce core, Data Cloud and Agentforce",
      "Configure the platform: users, permission sets, sender domains, branding and channels",
      "Bring data into Data Cloud, resolve identities and build unified customer profiles",
      "Build and activate segments for campaigns",
      "Create email, SMS and WhatsApp content and reusable templates",
      "Design, test and launch multi-step journeys with Flow",
      "Set up consent, communication subscriptions and a preference centre",
      "Use Agentforce to plan campaigns, generate content and build journeys with human review",
      "Measure performance with dashboards and A/B tests",
      "Plan a migration from Marketing Cloud Engagement or Account Engagement"
    ],
    "certificate": "Certificate of completion from Adrenaline Rush after the real-life project. Includes guidance for the relevant Salesforce marketing and Data Cloud certification exams (exam fees are paid to Salesforce separately).",
    "faqs": [
      {
        "q": "How is Marketing Cloud Next different from Marketing Cloud Engagement?",
        "a": "Engagement is the established platform with Email Studio, Journey Builder and Automation Studio. Marketing Cloud Next runs on the core Salesforce platform with Data Cloud and Agentforce built in. Many companies run both during a migration, and the course covers how they fit together."
      },
      {
        "q": "Do I need a paid Salesforce licence?",
        "a": "No. You practise on a training org during the course. Some features depend on edition and licence; the trainer shows these in a demo org where needed."
      },
      {
        "q": "Do I need coding skills?",
        "a": "No. Most work is point-and-click. Basic HTML and CSS help with email content and are taught in our HTML & CSS course."
      },
      {
        "q": "Is the demo class free?",
        "a": "Yes. Book a free demo, meet the trainer and see how the classes run before you decide."
      },
      {
        "q": "Are classes live or recorded?",
        "a": "Classes are live online. Recordings are shared after each session so you can revise."
      },
      {
        "q": "Do I get support after the course?",
        "a": "Yes. You can reach the trainer for questions from your job or project after the course ends."
      }
    ],
    "modules": [
      {
        "title": "Marketing Cloud Next overview",
        "description": "What the platform is and where it fits in the Salesforce marketing family.",
        "lessons": [
          {
            "title": "Salesforce marketing products: Engagement, Account Engagement, MCP and Marketing Cloud Next",
            "minutes": 45
          },
          {
            "title": "Architecture: Salesforce core, Data Cloud (Data 360) and Agentforce",
            "minutes": 45
          },
          {
            "title": "Editions, licences, add-ons and typical customer scenarios",
            "minutes": 30
          },
          {
            "title": "Tour of the Marketing app, campaigns and the marketing workspace",
            "minutes": 45
          }
        ]
      },
      {
        "title": "Platform setup and administration",
        "description": "Getting an org ready to send.",
        "lessons": [
          {
            "title": "Marketing setup: users, permission sets and roles",
            "minutes": 45
          },
          {
            "title": "Sender profiles, domains and email authentication (SPF, DKIM, DMARC)",
            "minutes": 45
          },
          {
            "title": "Brand kit, default content settings and business units",
            "minutes": 30
          },
          {
            "title": "Channel setup: email, SMS and WhatsApp",
            "minutes": 45
          }
        ]
      },
      {
        "title": "Data Cloud foundations",
        "description": "Bringing customer data together.",
        "lessons": [
          {
            "title": "Data Cloud concepts: data streams, data lake and data model objects",
            "minutes": 45
          },
          {
            "title": "Connecting Salesforce CRM and external data sources",
            "minutes": 45
          },
          {
            "title": "Mapping data to the customer data model",
            "minutes": 45
          },
          {
            "title": "Data spaces and data governance basics",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Identity resolution and unified profiles",
        "description": "One profile per customer across every system.",
        "lessons": [
          {
            "title": "Match and reconciliation rules",
            "minutes": 45
          },
          {
            "title": "Unified individuals and contact points",
            "minutes": 30
          },
          {
            "title": "Calculated and streaming insights",
            "minutes": 45
          },
          {
            "title": "Profile explorer and data quality checks",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Segmentation and activation",
        "description": "Choosing exactly who gets what.",
        "lessons": [
          {
            "title": "Building segments on unified data",
            "minutes": 45
          },
          {
            "title": "Nested, waterfall and exclusion segments",
            "minutes": 40
          },
          {
            "title": "Activation targets and publishing schedules",
            "minutes": 35
          },
          {
            "title": "Lab: lifecycle segments for a sample brand",
            "minutes": 45
          }
        ]
      },
      {
        "title": "Content: email, SMS and WhatsApp",
        "description": "Creating on-brand messages fast.",
        "lessons": [
          {
            "title": "The email builder: layouts, components and reusable content",
            "minutes": 45
          },
          {
            "title": "Templates, brand kit and HTML content blocks",
            "minutes": 40
          },
          {
            "title": "SMS and WhatsApp messages: templates, opt-in and best practice",
            "minutes": 45
          },
          {
            "title": "Forms and landing pages for lead capture",
            "minutes": 30
          },
          {
            "title": "Previews, test sends and rendering checks",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Journeys with Flow",
        "description": "Automating multi-step customer journeys.",
        "lessons": [
          {
            "title": "Marketing flows: triggers, entry criteria and audiences",
            "minutes": 45
          },
          {
            "title": "Waits, decision splits and engagement-based paths",
            "minutes": 45
          },
          {
            "title": "Multi-channel steps: email, SMS and WhatsApp in one journey",
            "minutes": 40
          },
          {
            "title": "Testing, debugging and monitoring live journeys",
            "minutes": 40
          },
          {
            "title": "Lab: welcome and abandoned-cart journeys",
            "minutes": 60
          }
        ]
      },
      {
        "title": "Consent, compliance and deliverability",
        "description": "Sending legally and landing in the inbox.",
        "lessons": [
          {
            "title": "Consent model: communication subscriptions and channel consent",
            "minutes": 45
          },
          {
            "title": "Preference centres and unsubscribe handling",
            "minutes": 30
          },
          {
            "title": "Privacy basics: India's DPDP Act, GDPR and CAN-SPAM",
            "minutes": 30
          },
          {
            "title": "Deliverability: reputation, warm-up and list hygiene",
            "minutes": 35
          }
        ]
      },
      {
        "title": "Personalization",
        "description": "The right message for each person.",
        "lessons": [
          {
            "title": "Merge fields and dynamic content",
            "minutes": 40
          },
          {
            "title": "Personalization with Data Cloud attributes and insights",
            "minutes": 40
          },
          {
            "title": "Product and content recommendations",
            "minutes": 35
          },
          {
            "title": "Connecting with Marketing Cloud Personalization (MCP)",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Agentforce for marketing",
        "description": "Working with AI agents, with humans in control.",
        "lessons": [
          {
            "title": "Agentforce concepts: agents, topics, actions and the Einstein Trust Layer",
            "minutes": 45
          },
          {
            "title": "Generating campaign briefs, segments and journeys with AI",
            "minutes": 45
          },
          {
            "title": "Generating and refining email and SMS content with brand guardrails",
            "minutes": 40
          },
          {
            "title": "Reviewing, approving and measuring AI-generated work",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Analytics and optimisation",
        "description": "Proving results and improving them.",
        "lessons": [
          {
            "title": "Engagement metrics and campaign performance dashboards",
            "minutes": 40
          },
          {
            "title": "A/B tests and send-time choices",
            "minutes": 35
          },
          {
            "title": "Attribution basics and connecting results to pipeline",
            "minutes": 35
          },
          {
            "title": "Reporting to stakeholders",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Integration and migration",
        "description": "Working with the rest of Salesforce and moving from older tools.",
        "lessons": [
          {
            "title": "Sales Cloud, Service Cloud and Commerce data in marketing",
            "minutes": 40
          },
          {
            "title": "Planning a migration from Marketing Cloud Engagement",
            "minutes": 45
          },
          {
            "title": "Planning a migration from Account Engagement (Pardot)",
            "minutes": 35
          },
          {
            "title": "Running Marketing Cloud Next alongside Engagement",
            "minutes": 30
          }
        ]
      },
      {
        "title": "Real-life project",
        "description": "An end-to-end lifecycle programme for a sample brand.",
        "lessons": [
          {
            "title": "Requirements, solution design and data plan",
            "minutes": 60
          },
          {
            "title": "Data Cloud setup, identity resolution and segments",
            "minutes": 90
          },
          {
            "title": "Content and multi-channel journeys",
            "minutes": 90
          },
          {
            "title": "Testing, go-live checklist, reporting and handover",
            "minutes": 60
          }
        ]
      },
      {
        "title": "Interview, certification and career preparation",
        "description": "Getting ready for Marketing Cloud Next roles.",
        "lessons": [
          {
            "title": "Common Marketing Cloud Next and Data Cloud interview questions",
            "minutes": 45
          },
          {
            "title": "Scenario-based solution design questions",
            "minutes": 45
          },
          {
            "title": "Certification paths and exam preparation",
            "minutes": 30
          },
          {
            "title": "Resume and LinkedIn profile review",
            "minutes": 30
          },
          {
            "title": "Mock interview",
            "minutes": 60
          }
        ]
      }
    ]
  }
]$json$::jsonb;
begin
  if org is null then
    raise exception 'No organization yet: create your admin login first (npm run admin:password or /setup), then run this script again.';
  end if;

  for c in select value from jsonb_array_elements(courses) loop
    insert into public.course_categories (organization_id, slug, name, description)
    values (org, c #>> '{category,0}', c #>> '{category,1}', c #>> '{category,2}')
    on conflict (organization_id, slug) do nothing;
    select id into cat_id from public.course_categories where organization_id = org and slug = c #>> '{category,0}';

    select id into v_course from public.courses where organization_id = org and slug = c ->> 'slug';

    if v_course is null then
      insert into public.courses (
        organization_id, category_id, slug, title, status, delivery_mode, currency, show_price, list_price, discounted_price
      ) values (
        org, cat_id, c ->> 'slug', c ->> 'title',
        (case when publish_now then 'published' else 'draft' end)::public.course_status,
        'online', 'INR', false, null, null
      ) returning id into v_course;
      created := created || (c ->> 'slug');
    else
      updated := updated || (c ->> 'slug');
    end if;

    update public.courses set
      category_id         = cat_id,
      title               = c ->> 'title',
      short_description   = c ->> 'short_description',
      description         = c ->> 'description',
      who_is_it_for       = c ->> 'who_is_it_for',
      prerequisites       = c ->> 'prerequisites',
      learning_outcomes   = array(select jsonb_array_elements_text(c -> 'outcomes')),
      level               = c ->> 'level',
      duration_text       = c ->> 'duration',
      cover_image_url     = c ->> 'cover',
      certificate_details = c ->> 'certificate',
      faqs                = c -> 'faqs',
      inclusions          = std_inclusions,
      registration_mode   = 'demo',
      cta_label           = c ->> 'cta',
      highlight_badge     = c ->> 'badge'
    where id = v_course;

    -- Replace the curriculum (modules and lessons only; nothing else links to them).
    delete from public.course_modules where course_id = v_course;
    m_pos := 0;
    for m in select value from jsonb_array_elements(c -> 'modules') loop
      m_pos := m_pos + 10;
      insert into public.course_modules (course_id, title, description, position)
      values (v_course, m ->> 'title', m ->> 'description', m_pos)
      returning id into mod_id;
      l_pos := 0;
      for l in select value from jsonb_array_elements(m -> 'lessons') loop
        l_pos := l_pos + 10;
        insert into public.lessons (module_id, title, duration_minutes, position)
        values (mod_id, l ->> 'title', (l ->> 'minutes')::integer, l_pos);
      end loop;
    end loop;
  end loop;

  -- Give the existing MCP course its cover if it has none.
  update public.courses set cover_image_url = '/covers/mcp.svg'
  where organization_id = org and slug = 'mcp' and cover_image_url is null;

  raise notice 'Created: %', coalesce(nullif(array_to_string(created, ', '), ''), 'none');
  raise notice 'Updated (status, prices and registrations kept): %', coalesce(nullif(array_to_string(updated, ', '), ''), 'none');
end $$;

-- Check the result: one row per course with its module and lesson counts.
select c.slug, c.title, c.status, c.cover_image_url,
       count(distinct m.id) as modules, count(l.id) as lessons,
       round(coalesce(sum(l.duration_minutes), 0) / 60.0, 1) as hours
from public.courses c
left join public.course_modules m on m.course_id = c.id
left join public.lessons l on l.module_id = m.id
where c.organization_id = public.primary_organization_id()
  and c.slug in ('html-css', 'marketing-cloud-next', 'mcp')
group by c.id
order by c.slug;
