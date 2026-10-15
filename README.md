# Adrenaline Rush

Training-business operating system: courses, public registration pages, candidate CRM, demos and
resources, batches and sessions, attendance, fees and expenses, analytics.

**Status:** Stage 1 delivered: foundation, Lightning-style redesign, one-file database setup, courses,
public course pages with registration forms, and the candidate CRM. See
[docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md).

**New here? Follow [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)** (database, local run, GitHub, Vercel).

## Stack

Next.js 16 (App Router, TypeScript strict) · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS) ·
React Hook Form + Zod · Recharts · Vitest · Playwright · Vercel.

## Quick start

```bash
# 1. Supabase → SQL Editor → paste supabase/setup.sql → Run
# 2. Fill the three Supabase values in .env.local
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000/setup once to create the business and owner account.

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md) | Plain step-by-step: database, local run, GitHub, Vercel, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture decisions, structure, data model |
| [docs/AUTH.md](docs/AUTH.md) | Sign-in, first admin, roles, permissions, RLS, secrets |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, tests, migrations |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Supabase + Vercel hosting, domain, smoke test, backups, rollback |
| [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) | What's done, what was verified, what's next |

## Scripts

`dev` · `build` · `start` · `lint` · `typecheck` · `test` (unit) · `test:db` (RLS on Postgres) ·
`test:e2e` (Playwright) · `check` (all but e2e) · `db:setup-sql` · `db:types`
