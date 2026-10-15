# Implementation log

## Phase 0 — Discovery and architecture (2026-10-14) ✅

- Workspace: empty; no repository attached yet. Tools available in the build environment: Node 22, npm 10,
  PostgreSQL 16, Git, Playwright Chromium. No Docker (so the Supabase local stack could not be used for
  testing; a Supabase auth stub on plain Postgres is used for RLS tests instead).
- Decisions recorded in `docs/ARCHITECTURE.md`.
- External accounts needed: GitHub, Supabase, Vercel (+ domain). Later phases: Google Cloud OAuth client
  (Phase 5), email provider such as Resend (Phase 8), optionally Razorpay (Phase 9).

## Phase 1 — Foundation (2026-10-14) ✅ (pending live Supabase verification)

Built:
- Next.js 16.4 App Router, React 19, TypeScript strict, Tailwind CSS 4, Cache Components.
- Design tokens and UI primitives (button, card, badge, alert, field/input/select/checkbox, empty state),
  original text logo + mark, responsive admin shell with permission-filtered navigation and mobile drawer.
- Supabase clients (server/cookie, secret-key admin, proxy session refresh) and validated env config.
- Migrations: organizations, profiles, memberships, permission catalog + role defaults + overrides,
  audit log (immutable, trigger-written), first-owner bootstrap, health check, Postgres rate limiter.
  RLS on every table.
- Auth: email/password login (rate limited, generic errors, open-redirect-safe `next`), sign-out,
  one-time `/setup` for the first owner, `/no-access` state.
- Admin: dashboard (getting-started, no fake metrics), Settings (business profile, own profile, team list,
  integration status), guarded placeholders for the other nine modules.
- `/api/health` database probe. Security headers. Structured, PII-free server logs.
- Docs: architecture, auth, development, deployment (Vercel + Supabase + domain + backups). CI workflow.

Verified (actual results in the build environment):
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm test` — 46 unit tests passing (permissions, routes/open redirect, validation, token helpers).
- `npm run test:db` — 29 database tests passing on PostgreSQL 16 (RLS, triggers, bootstrap, rate limit).
- `npm run build` — succeeds. No secret values found in `.next/static`.
- `npm run test:e2e` — 18 passed (desktop + mobile): public page, redirects for `/admin/*`, no admin HTML
  in redirect responses, login server validation, security headers, health endpoint.
  4 skipped: owner sign-in tests need a real Supabase project (`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`).

Not yet verified (needs your Supabase project):
- Migrations applied to hosted Supabase with `supabase db push`.
- Real sign-in, `/setup`, settings save, and the signed-in admin shell rendering.

## Stage 1 — Redesign, one-file database setup, courses and CRM (2026-10-14) ✅

Built:
- **Lightning-inspired redesign** (no Salesforce logos): SLDS-like colours, Inter + Space Grotesk, global
  header with search, app launcher and object tabs, object-icon page headers, path bar, cards. Effects:
  aurora hero, perspective grid, glass, spotlight, tilt, scroll reveal (content stays visible without JS),
  page transitions, shimmer skeletons. All animation is off under "reduce motion".
- **Easier database setup:** `supabase/setup.sql` (all migrations in one idempotent file) pasted into the
  Supabase SQL Editor. Only three env vars are required; `/setup` works without a token under `npm run dev`;
  `RATE_LIMIT_SALT` falls back to a value derived from the secret key.
- **Public site:** home, course catalogue with category filter, course pages (curriculum, outcomes, FAQs,
  price/"contact for fees"), dynamic registration form with consent, UTM capture, honeypot, minimum fill
  time, one-time token and per-IP rate limit; thank-you page; About, FAQ, Privacy (template), Terms
  (template).
- **Courses (admin):** list with search/status/category filters, create/edit every course field,
  categories, curriculum editor (`## module` / `- lesson (45m)`), registration form builder (custom
  fields, reorder, show/hide; consent, name and email-or-phone protected), publish/unpublish/archive,
  clone, delete drafts, copy public link, registrations per course.
- **Candidate CRM:** list with search, status/course/owner/source/overdue filters, sorting, pagination;
  manual create with duplicate check; profile with status path, editable details, owner assignment,
  registrations and answers, notes, follow-ups (org time zone), activity timeline; CSV import (map,
  preview, validate, dedupe, atomic commit via `import_candidates`); permissioned, formula-safe CSV
  export with an audit-log entry; lead-status configuration in Settings.
- Dashboard with live counts (candidates, new this week, registrations, published courses, overdue
  follow-ups) and a getting-started checklist; global search.

Verified (actual results in the build environment):
- `npm run lint` and `npm run typecheck` — clean.
- `npm test` — 161 unit tests passing. `npm run test:db` — 57 database tests passing on PostgreSQL 16,
  including `setup.sql` applied twice and checked to be up to date.
- `npm run build` — succeeds; the secret key does not appear in `.next/static`.
- **Full end-to-end flow against a real Supabase Auth (GoTrue v2.180.0) and PostgREST v12.2.3 stack**
  (`scripts/local-supabase/up.sh`, `E2E_FULL=1 npx playwright test tests/e2e/full-flow.spec.ts`): 6/6
  passed — setup page creates owner then disappears; create course, curriculum, publish; public
  registration twice with the same person (one candidate, second registration flagged); status change,
  note, follow-up; CSV export; search; CSV import (1 created, 1 duplicate, 1 invalid); sign out.
- Rest of the Playwright suite (desktop + mobile), including owner sign-in tests against the same stack:
  40 passed.
- This run found and fixed four bugs: course/category/form-field forms re-sent parsed values (saving
  failed); "From title" ignored text typed before the page finished loading; admin pages hit a
  prerender `Date.now()` error during prefetch; new follow-ups defaulted to an already-past time.

Not yet verified:
- Your hosted Supabase project and Vercel deployment (follow `docs/SETUP_GUIDE.md`).
- Layout at phone width was checked by screenshots of the main screens, not every screen.

## Stage 1.1 — Owner feedback: admin access, simple footer, MCP launch, demo emails (2026-10-14) ✅

Built:
- Admin is reached only by its URL (`/admin`); no public page links to it. Login creation and recovery:
  `npm run admin:password` (create/reset owner, confirms email, bootstraps on first use); `/setup` on a
  deployed site now proves ownership with the Supabase secret key (or `ADMIN_SETUP_TOKEN`); clearer sign-in
  errors (wrong keys vs wrong password); Settings → Sign-in details to change email/password (stays signed in).
- Normal website footer driven by Settings → Website (tagline, contact, WhatsApp, social links).
- Courses: "What's included" (icons, suggested items), free-demo registration mode (decided on the server),
  button label, highlight badge; shorter default registration form for new courses. Website settings page
  (hero text, featured course, contact, social, about text, catalogue on/off). Optional draft MCP starter.
- Email: Gmail/SMTP or Resend (env vars only); templates with header image upload, live preview, test send,
  custom HTML; automations (course/type filters, candidate/team/custom recipients); email log with honest
  statuses; images stored in Postgres and served at `/media/<id>`. Demo bookings email the candidate and
  the team by default, after the visitor's page has loaded.

Verified (actual results):
- lint and typecheck clean; 202 unit tests; 87 database tests (setup.sql applied twice, up to date).
- Full browser flow against real Supabase Auth + PostgREST **and a local SMTP server with STARTTLS**:
  10/10 passed — setup with the secret key, course with inclusions, two demo bookings → 4 real SMTP
  messages (2 to the candidate, 2 to the team), template edit with image upload served from `/media`,
  email log shows Sent, website settings shown in the footer, CRM, export/search/import, sign out,
  `npm run admin:password` reset then password change from Settings.
- Remaining Playwright suite incl. owner sign-in: 40 passed. MCP starter script applied cleanly.

Not verified here: real delivery through Gmail or Resend (needs your account), your Supabase/Vercel.

## Remaining tasks / known limitations

- Staff/instructor **invitation** flow and per-member permission override UI (schema ready).
- Password reset / change-password flow (needs Supabase email or a custom SMTP; planned with Phase 8,
  or earlier if you want it).
- Content Security Policy with nonces (other security headers are active).
- `npm audit` reports 5 high-severity advisories in ESLint's dev-only dependency chain
  (`braces`/`micromatch` via `eslint-config-next`); they do not ship to production. The suggested
  `--force` fix downgrades Next's ESLint config, so it was not applied.
- Clone of a course is not one transaction; if copying stops part way the copied course says so.
- Imported contacts never receive marketing/privacy consent automatically; existing candidates are skipped,
  not updated.
- Next: **Stage 2 — demos/resources and sharing, batches and enrolments, sessions/calendar (Google Meet
  optional), attendance.** Then Stage 3 — finance, analytics and charts, campaigns, reports, messaging.
