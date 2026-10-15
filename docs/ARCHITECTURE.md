# Architecture decisions

Status: accepted for Phase 1 (2026-10-14). Revisit when a decision below stops holding.

## Context

Adrenaline Rush is a single-business training operations platform (courses, candidates, demos, batches,
sessions, finance, analytics) that must be secure, cheap to run, and maintainable by one technical owner.
The workspace was empty at the start of Phase 0.

## Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | **Next.js 16 App Router + TypeScript (strict)**, Server Components by default, Server Actions for mutations | One codebase for public site, admin and API. Server Actions are POST-only with built-in Origin checks (CSRF). |
| 2 | **Cache Components on** (Next 16 default). Anything that reads the session renders inside `<Suspense>` | Public pages prerender to a static shell; authenticated UI streams per request. |
| 3 | **Supabase Postgres + Supabase Auth**, accessed with `@supabase/ssr` cookie sessions | Managed Postgres, auth and storage in one service; RLS is first-class. |
| 4 | **Authorization in three layers**: (a) `proxy.ts` optimistic redirect, (b) `requireAccess()` / `assertPermission()` in every page and action, (c) **Row Level Security** in Postgres | The database is the final gate, so a bug in UI code cannot leak data. |
| 5 | **Permission keys, not role checks**, e.g. `finance.view`. Roles (`owner`, `admin`, `staff`, `instructor`) map to default permissions in `role_permissions`; per-member overrides in `membership_permission_overrides` | Lets the owner tailor staff access later without code changes. Owner always has everything. |
| 6 | **Multi-tenant-ready schema** (`organizations` + `organization_memberships`), single business in practice | Spec asks for future expansion; cost is one `organization_id` column per table. |
| 7 | **No public signup**. First owner via one-time `/setup` guarded by `ADMIN_SETUP_TOKEN` + DB function that refuses once any organization exists | Spec forbids open admin signup. Works without CLI access to the database. |
| 8 | **Version-controlled SQL migrations** in `supabase/migrations`, combined into one idempotent `supabase/setup.sql` that is pasted into the SQL Editor (or applied with `supabase db push`) | Reviewable, repeatable, no ORM lock-in. Types generated from the schema. |
| 9 | **Money as `numeric(12,2)` + explicit `char(3)` currency** (from Phase 6); all timestamps `timestamptz`, displayed in the org time zone | No floating-point money; consistent reporting periods. |
| 10 | **Postgres-backed rate limiting** (`consume_rate_limit`) with hashed keys | Works on serverless (no shared memory), no extra paid service, stores no raw IPs or emails. |
| 11 | **Hand-built accessible UI kit** (`src/components/ui`) in the shadcn style (Tailwind + CVA), Lucide icons, Recharts for charts (Phase 7) | Small, owned, no generator dependency; consistent tokens in `globals.css`. |
| 12 | **Forms**: Zod schemas shared by client (React Hook Form) and server (re-validated in every action) | Never trust client validation. |
| 13 | **Tests**: Vitest unit tests; Vitest + `pg` RLS tests against real PostgreSQL with a minimal Supabase auth stub; Playwright e2e | RLS is tested where it lives, without needing Docker or a cloud project. |
| 14 | **Hosting**: Vercel (app) + Supabase (DB/Auth/Storage), region close to users (Mumbai) | Spec choice; zero server maintenance. |
| 15 | **Integrations are optional adapters** (Google Calendar/Meet in Phase 5, email in Phase 8, payments in Phase 9) with manual fallbacks | The business must keep working when a provider is not configured or fails. |

## Structure

```
src/
  app/                 routes (public site, (auth) pages, /admin, /api)
    actions/           Server Actions (auth, settings) — each re-authorises
  components/
    ui/                design system primitives
    admin/             dashboard shell, nav, guards
    brand/             logo
  lib/
    auth/              permissions catalog, route guards, session DAL
    supabase/          server, admin (secret key) and proxy clients
    security/          rate limiting, constant-time compare, key hashing
    validation/        Zod schemas
    env.ts             public env (validated)
    env.server.ts      server-only secrets (import fails in client code)
    database.types.ts  generated from migrations
  proxy.ts             session refresh + optimistic redirect
supabase/
  migrations/          SQL migrations (source of truth for schema + RLS)
  config.toml          local Supabase CLI config (signup disabled)
tests/
  db/                  RLS / database tests
  e2e/                 Playwright
docs/                  architecture, auth, deployment, log
```

## Data model (Phase 1)

- `organizations` — business profile, time zone, default currency, staff/instructor switches.
- `user_profiles` — 1:1 with `auth.users`, created by trigger.
- `organization_memberships` — user ↔ org with role and status. Triggers enforce: only the owner grants
  owner/admin, nobody edits their own membership, at least one active owner remains.
- `permissions`, `role_permissions`, `membership_permission_overrides` — permission model.
- `audit_logs` — append-only; settings and membership changes are written by triggers.
- `rate_limit_buckets` — service-role only.

Later phases add courses, candidates, batches, sessions, enrollments, finance and campaign tables with
the same conventions (UUID keys, `organization_id`, timestamps, RLS via `has_permission`).

## Retention and deletion (initial policy)

- Audit log entries are immutable and kept for the life of the organization.
- Deleting an auth user cascades to their profile and memberships; the last owner cannot be removed.
- Candidate data deletion/correction workflow and retention periods are defined with the CRM (Phase 3).
  Soft deletion will be used only where reports must keep history (e.g. archived courses).

## Unresolved decisions (none block Phase 2)

1. ~~Email provider~~ Decided: optional Gmail/SMTP (nodemailer) or Resend, configured by environment variables; without one, emails are logged as "not sent" (`src/lib/email`).
2. Payment gateway (Razorpay likely; Phase 9, optional).
3. Whether to add a student portal (post-MVP).
4. Content Security Policy with nonces (planned with Phase 9 hardening; other security headers are on now).
