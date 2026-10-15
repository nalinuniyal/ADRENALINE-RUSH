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

## Stage 2 — Team, demos and resources, batches and scheduling (2026-10-15) ✅

### Demos & Resources and sharing (2026-10-15) ✅

Built (migration `20261014000009_demos_resources.sql`):
- Resource library at `/admin/resources` (nav "Demos"): demo videos, recordings, curriculum, project
  examples, GitHub/documentation links; type, description, courses, internal/shareable, on/off, expiry,
  access instructions, thumbnail; filters by type/course/status, search, share counts on each card.
- Public page `/r/<slug>` (random suffix, `noindex`) for shareable, active, unexpired resources only, via
  `get_public_resource()`; YouTube (nocookie)/Vimeo/Drive/Loom embeds from an allowlist, otherwise a link
  button; published courses with a "Book a free demo" button.
- Message templates (3 seeded per organization, editable, placeholders, live preview).
- Share screen (from the library, a resource or a candidate profile; bulk up to 50): preview per candidate,
  copy message, copy link, WhatsApp click-to-chat (`wa.me`, default country code in Settings → Integrations),
  email through the existing email layer (logged in the email log as "share") with a confirmation step;
  optional move to "Demo Shared". Do-not-contact candidates are skipped.
- `resource_shares` log with honest statuses (copied/opened are never "sent"); a trigger adds a
  `resource_shared` activity to the candidate timeline. Share history per resource, per candidate and overall.

Verified: unit tests (embed parsing, message rendering, wa.me numbers, validation), database tests
(RLS: instructor without `resources.share` cannot share, staff only with their assigned candidates,
anon only through the public RPC; honest status checks; seeding), lint, typecheck, build. Browser run
against the local Supabase stack: create resource → share by WhatsApp link and copy → timeline activity →
public page; bulk email to two candidates through a local SMTP server. Not verified: real WhatsApp,
real Gmail/Resend delivery, video embeds playing (no internet access from the test machine).

### Batches, enrollments, calendar, sessions, attendance, Google Meet

Built (migration `20261014000010_batches_sessions.sql`, included in `supabase/setup.sql`):
- **Batches** (`/admin/batches`, new/detail/edit): course, code, seats, class days/times, time zone,
  instructor, default meeting link, status (planned/open/full/running/completed/cancelled). Status filter and
  search. Instructors see only their own batches (RLS). Audit log on create/update/delete.
- **Enrollments**: search and enroll from the batch or from the candidate profile; seat limit checked under a
  row lock (no overbooking under concurrency); no duplicates; batch flips full/open automatically; status
  changes; transfer between batches of the same course. Enrolling sets the lead status to Enrolled and logs a
  candidate activity. Deliberately **no fee/payment columns**: finance will reference `enrollment_id`.
- **Sessions** (`/admin/calendar`, month / week / phone agenda without a calendar library): class sessions
  per batch, bulk generation from the batch schedule (time-zone aware, idempotent), one-off classes, demo
  sessions without a batch with invitees from demo bookings (marking them attended sets lead status
  "demo attended"). Cancel/restore/delete; times stored in UTC, shown in the session's zone.
- **Meeting links**: manual https link always available; optional Google Calendar event with a Meet link
  (deterministic event id and conference request id so retries never duplicate; patch on edit, delete on
  cancel/delete; failures keep the session and show a Retry button). Attendee invitations are off by default.
- **Google OAuth** (Settings → Integrations): authorization-code flow with PKCE, offline access, scope
  `calendar.events` only, signed state cookie bound to the signed-in user and business, refresh token
  encrypted with AES-256-GCM (`INTEGRATIONS_ENCRYPTION_KEY`, fallback derived from `SUPABASE_SECRET_KEY`),
  token columns unreadable by the browser roles; revoked/expired access is detected and shown as
  "Needs reconnecting". Connect/disconnect/reconnect are audited.
- **Attendance**: present/late/absent/excused, "Mark all present", opens 30 minutes before the start; only
  enrolled students (or invited demo guests). % per student and per batch on batch and candidate pages,
  progress attended/total, recording link per session. Dashboard "Upcoming sessions" card.

Verified (actual results, local Postgres + PostgREST stack):
- New database tests (`tests/db/batches.test.ts`): RLS per role, capacity incl. two concurrent connections,
  duplicates, transfer, lead status/activities, attendance rules, demo invitees, token columns hidden.
- Unit tests: schedule generation (incl. Asia/Kolkata and DST zones), attendance maths, calendar helpers,
  validation, token encryption and state cookie, Google adapter with a stubbed HTTP layer.
- Browser run on the dev server: create batch → enroll → generate classes → session with a manual link →
  mark all present → 100% on the batch and candidate pages; calendar month/week; no horizontal scroll at
  390px. A new E2E_FULL-gated spec (`tests/e2e/stage2-batches.spec.ts`) covers the same flow.

Not verified here: the real Google OAuth consent and Calendar/Meet API (no access to Google from this
environment; the adapter is tested against recorded request/response shapes only). Your Supabase/Vercel.


### Team management and invitations (branch stage2-team)

- Migration `20261014000008_team_invitations.sql`: `team_invitations` (sha256-hashed single-use token,
  7-day expiry, pending/accepted/revoked/expired, email outcome), trigger rules (only the owner invites
  or alters admins, closed invites cannot be reopened, existing members cannot be re-invited, expiry
  within 30 days), service-role `get_team_invitation` / `accept_team_invitation`, override rules (only
  the owner touches admin overrides; nobody grants what they lack), audit entries for invites and
  overrides, and an editable "Team invitation" email template.
- Settings → Team (`/admin/settings/team`): invite by name/email/role (+ optional WhatsApp number),
  email via the existing provider plus "Copy invite link" and WhatsApp share; resend (new link) and
  cancel; role change, suspend/reactivate, remove; per-member permission overrides.
- Public `/invite/[token]` (rate limited, noindex, no referrer): creates a confirmed login or links an
  existing one by its current password, activates the membership, signs in and opens `/admin`.
- `/admin/account` (avatar menu → My account) so staff and instructors can change their own name and password.
- Tests: `tests/db/team.test.ts`, unit tests in `src/lib/team/*` and `src/lib/validation/team.test.ts`,
  E2E_FULL-gated `tests/e2e/team-invite.spec.ts`.


## Stage 3

### Payments & Expenses (branch stage3-finance, 2026-10-15)

Built (migration `20261014000011_finance.sql`, included in `supabase/setup.sql`):
- **Fee plans** (`/admin/finance/fees`, per student `/admin/finance/fees/<enrollmentId>`): one plan per
  enrollment, agreed fee defaulting to the course price, discount as amount or % with a required reason,
  currency (INR default), optional installment schedule that must equal the final fee (deferred constraint
  trigger + form check), "Split evenly" helper. Saved atomically through `save_fee_plan()`.
- **Payments**: manual methods with reference, optional installment; when none is chosen the money fills the
  earliest unpaid installment (waterfall computed on the fly in SQL `fee_plan_allocation()` and mirrored in
  `src/lib/finance/money.ts`). Pending → received/failed. Sequential receipt numbers `AR-YYYY-0001` per business
  and year (counter row, no gaps from concurrency), printable receipt `/admin/finance/receipts/<id>`.
- **Refunds** capped at payment minus earlier refunds (checked under a row lock), reason required. Payments and
  refunds are voided with a reason, never deleted; every money change writes the audit log.
- **Outstanding / overdue / installment status** are computed (view `fee_plan_balances`, `fee_plan_schedule()`),
  never stored; cancelled/dropped enrollments are excluded from dues, not from collections.
- **Money**: `numeric(12,2)` in the database, integer paise in JS (BigInt for percentages); no floats.
- **Overview** `/admin/finance`: KPIs (gross, refunds, net, expenses, cash result, outstanding, overdue) with
  date range / course / batch filters via `finance_summary()`; overdue list with WhatsApp click-to-chat and email
  reminders, each logged as a `fee_reminder` candidate activity (no amounts) and emails in the email log.
- **Payments list / Expenses list** with filters and CSV export (needs finance.view + reports.export, audited).
  Expenses with seeded, editable categories; edit and void.
- **Elsewhere**: "Fees & payments" card on the candidate profile, fee summary on the batch page, Settings ›
  Integrations "Payment gateway (Razorpay)" row (replaces "Not connected · Phase 9").
- **Razorpay payment links (optional)**: server-only adapter with injectable fetch; link amount computed on the
  server; webhook `/api/webhooks/razorpay` verifies the HMAC-SHA256 signature (timing-safe, size-limited) and
  records through service-role `record_gateway_payment()`, idempotent by Razorpay payment id. Handles
  `payment_link.paid / partially_paid / expired / cancelled`; other events (e.g. `payment.captured`) are
  acknowledged and ignored. Thank-you page `/pay/thank-you`. Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`.
- **Permissions**: finance.view / finance.manage enforced in RLS, server actions and pages; staff and instructors
  cannot read payments, refunds, fee plans or links.

Verified (actual results, local Postgres + PostgREST stack):
- `tests/db/finance.test.ts` (17): discount maths, installment sum, one plan per enrollment, receipt numbering,
  allocation/statuses, refund cap and void, immutability, summary filters, RLS for staff/instructor/outsider/anon,
  webhook idempotency, reminder activity without amounts. All db tests 166/166.
- Unit tests for money maths, Razorpay adapter/signature/webhook parsing, CSV export, reminders, validation
  (unit suite 387/387). Lint, typecheck, build.
- Browser run on the dev server of the new E2E_FULL-gated `tests/e2e/stage3-finance.spec.ts` (scenarios 13–16;
  scenario 18, which switches on staff accounts, was left to the full fresh-stack run).

Not verified: Razorpay itself (no access from this environment; the adapter and webhook are tested against
documented request/response shapes and locally computed signatures), real email delivery, your Supabase/Vercel.
Known limits: receipt prefix is fixed as `AR`; online refunds are issued in Razorpay and recorded by hand.


### Analytics & Reports (branch stage3-analytics, 2026-10-15)

Built (migration `20261014000012_analytics.sql`, included in `supabase/setup.sql`):
- **Reporting functions** (all SECURITY INVOKER, so RLS applies to the caller; reports.view required,
  `analytics_kpis` also allows dashboard.view): `analytics_kpis`, `analytics_activity_series` (day/week/month),
  `analytics_money_series` (finance.view; same rules as `finance_summary()`), `analytics_funnel` (furthest stage
  reached, from status, status history, demo requests/invites/attendance and enrollments; never widens),
  `analytics_lead_sources` (first-touch UTM source/medium/campaign), `analytics_course_performance` (money columns
  NULL without finance.view), `analytics_batch_attendance`, `analytics_top_resources`. Timestamps are bucketed in
  the organization's time zone.
- **/admin/analytics**: period presets (this month, last month, last 90 days, this year, custom) in the business
  time zone (`src/lib/analytics/range.ts`); KPI tiles whose money comes straight from `finance_summary()`;
  Recharts 3.10.1 (pinned) client charts fed by server data (leads/enrollments over time, money in/out per month,
  leads by source) plus server-rendered funnel, course performance table, batch attendance and top resources.
  Every chart has a "Show the numbers" table; empty states; definitions card. Colours: validated categorical
  slots 1–3 (light-only admin UI).
- **Reports** `/admin/analytics/reports` + `/admin/analytics/reports/[report]` (CSV, reports.export, finance.view
  for money, CRM access for people reports; RLS client; formula-injection-safe; audited as `reports.export`, fail
  closed): leads, lead sources, enrollments (fee columns with finance.view), attendance, course performance,
  refunds; payments and expenses link to the existing finance exports with the same dates.
- **Dashboard**: "This month" KPI row from the same functions; "Coming next" labels removed.

Verified (actual results): `tests/db/analytics.test.ts` 13/13 (reconciliation of monthly and per-course money
with `finance_summary()` after payments, a pending payment, a refund and a voided expense; funnel; sources;
attendance; time-zone boundary; RLS: staff with reports.view but no finance.view get NULL money and RLS-limited
counts, instructor and outsider denied, anon has no execute). Unit tests for periods in Asia/Kolkata and CSV
layouts. Browser check on the dev server against the shared local stack: pages render (desktop and 390px, no
horizontal scroll), Analytics net collections equalled the finance overview for the same dates, all six CSV
routes returned files, bad period → 400, unknown report → 404. New E2E_FULL-gated
`tests/e2e/stage3-analytics.spec.ts` (scenario 17) was written but not run here.

Known limits: campaign visits are not shown (no web analytics); demo bookings count demo requests and demo-session
invitations; the leads/enrollments charts count what the viewer can see under RLS.

## Stage 4

### UPI / bank transfer payments (branch stage4-upi, 2026-10-15)

Built (migration `20261014000013_upi_payments.sql`, included in `supabase/setup.sql`):
- `payment_settings` (one row per organization, seeded by trigger): UPI ID (VPA, lower-cased, CHECKed), payee
  name, optional own QR (`media_assets`, PNG/JPG), bank holder/number/IFSC (CHECKed)/name/branch/type,
  instructions, show-on toggles (pay page, reminders, course pages; course pages off by default) and the editable
  approval email. finance.view or settings.manage read, finance.manage or settings.manage write. The full account
  number is not column-granted: `payment_settings_account_number()` returns it to finance viewers only; others
  see `bank_account_last4`.
- `fee_pay_links`: `/pay/<token>` per fee plan (next installment or full balance, computed live); one live link
  per plan (`create_fee_pay_link()` revokes the old one); token = HMAC-SHA256(`PAY_LINK_SECRET` or the Supabase
  secret key, id.nonce), only sha256(token) and the nonce are stored, so the app can copy a link again but a
  database copy cannot open one.
- `payment_submissions`: "I've paid" reports (UTR, amount, date, method, note, optional screenshot bytea not
  granted to app users, served by `/admin/finance/verify/[id]/screenshot` after an RLS check). Written only by
  `submit_fee_payment_proof()` (anon via token hash; validates amount ≤ outstanding, date, UTR, screenshot type;
  per-link throttle 3 pending / 10 per day; duplicate UTR vs submissions and payments), decided by
  `approve_payment_submission()` (finance.manage; row lock; inserts exactly one completed payment, method upi /
  bank_transfer, reference = UTR, installment linked, receipt by the existing trigger; refuses a UTR already used)
  and `reject_payment_submission()`. Unique UTR per organization among non-rejected reports.
- `get_fee_pay_page()` (anon; only first name, course, amount due, reference and the payment details when "show
  on pay page" is on), `get_public_payment_details()` for course pages. Audit trigger: settings changes (account
  number masked), pay link created/revoked, report created/approved/rejected. `email_log.kind` allows
  `payment_confirmation`; `media_assets` gets an insert policy for payment-detail editors.
- App: Settings › Payment details (form + live preview with a client-drawn QR, QR upload), public `/pay/[token]`
  (noindex, no-referrer, IP rate limit for views and IP + token limits for reports; server-rendered SVG QR via
  `qrcode@1.5.4` pinned, "Pay with UPI app" `upi://pay` link, copy buttons, own-QR alternative, bank details, proof
  form), Finance › To verify list (approve with optional amount correction / reject with reason, duplicate
  warning), banner on the overview, badge + "Reported by the student" card + pay-link card (make / copy / WhatsApp
  / email / switch off) on the fee page, Pay link + WhatsApp pay link on overdue rows, reminders include the pay
  page and UPI ID when "show in reminders" is on, "Ways to pay" on course pages when switched on, approval email
  from the owner-editable template through the existing email layer.
- Reminder texts are built in code (`src/lib/finance/reminder.ts`), not templates, so there is no
  `{{pay_link}}`/`{{upi_id}}` placeholder: the link and UPI ID are added automatically instead. The approval email
  is a template with `{{first_name}} {{amount}} {{course}} {{receipt_number}} {{outstanding}} {{business_name}} {{utr}}`.

Verified (actual results): `tests/db/upi-payments.test.ts` 18/18 (RLS for owner/staff/instructor/anon, account
number not readable directly, masked audit, one live link, revoked token denied, page data limited to what the
candidate needs, validation, duplicate UTR vs reports and payments, throttle, approval records exactly one payment
and lowers the balance, re-approval refused, reject); unit tests (`src/lib/finance/upi.test.ts`, 19: VPA/IFSC/
account/UTR validation, masking, UPI link encoding and 2-decimal amounts, note length, QR returns SVG, token
derivation, form schemas, messages). Browser walk-through on the dev server against the shared local stack:
owner saved details (preview + QR shown), made a pay link, opened it at 390px (QR visible, ₹5,000, correct
`upi://` link), submitted a UTR, overview banner showed "1 payment to verify", approved, receipt issued and
outstanding dropped ₹15,000 → ₹10,000 → ₹0 on a second round. The confirmation email was attempted and logged
as failed (no SMTP server here). New E2E_FULL-gated `tests/e2e/stage4-upi.spec.ts` was written but not run.

Not verified: real UPI apps scanning the QR / opening the `upi://` link (no phone here; the link follows NPCI's
documented format), real email delivery. Known limits: UPI cannot confirm payments automatically without a
gateway (use Razorpay for that); the pay page uses the Asia/Kolkata date for the default "date paid".

### Roles & access (branch stage4-roles, 2026-10-15)

Built (migration `20261014000014_custom_roles.sql`, included in `supabase/setup.sql`):
- New permission `roles.manage` (owner only by default; re-removed from the admin default on every run).
- `organization_role_permissions` (per-org differences from the global built-in defaults; reset = delete),
  `custom_roles` (name, description, base role admin/staff/instructor, immutable base) and
  `custom_role_permissions`; `organization_memberships.custom_role_id` (composite FK, same org, ON DELETE
  RESTRICT) and `team_invitations.custom_role_id`. A trigger copies the custom role's base into
  `organization_memberships.role`, so every policy that scopes by role (instructor-only batches/sessions, sign-in
  switches, owner/admin rules, instructor picker) keeps working unchanged.
- Resolution (`role_grants`, `membership_permission`, `has_permission`): owner → per-member override →
  custom role list → org change → global default. `list_candidate_owners` now uses the same resolution.
  `get_my_access_v2()` adds the custom role (new name because a function's result columns cannot change on
  re-runs); the app uses it.
- Role writes only through SECURITY DEFINER functions (`create/update/delete_custom_role`,
  `set/reset_builtin_role_permissions`): need roles.manage; admin and admin-based roles owner-only; non-owners
  cannot add permissions they lack; unknown keys and duplicate names refused; deleting a role in use or on an
  open invitation refused. Membership and invitation triggers refuse giving a role with permissions the actor
  lacks. Audit: `role.created/updated/deleted/assigned/defaults_changed`. Tables are select-only for app users.
- `/admin/settings/roles`: built-in roles (owner locked) with edit + "Reset to default", custom roles with
  templates (Accounts, Counsellor - read only, Senior instructor), a permission matrix grouped by module with
  plain text, select-all per module, candidate scope radio, needs ("manage" ticks "view"), sensitive warnings,
  base-role scope notes. Team: role pickers and invite form list custom roles (ones beyond the actor disabled);
  per-member Permissions shows the real role defaults. Invite page/email/WhatsApp text use the custom name.
  Shell/account show the custom role name. Dashboard-less roles are redirected to their first module.

Verified: `tests/db/roles.test.ts` 21/21 (existing access unchanged, resolution order, RLS, escalation attempts,
data scope via base role, delete rules, invitation acceptance, audit); full db suite; unit tests for the matrix
and validation; the E2E_FULL-gated `tests/e2e/stage4-roles.spec.ts` passed 4/4 against the dev server on the
shared local stack.

Known limits: a finance-only role sees empty fee lists unless it can also see candidates (the screen warns and
the Accounts template includes "See every candidate"); batch/class scope comes from the base role, not a
separate choice.

## Remaining tasks / known limitations

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
