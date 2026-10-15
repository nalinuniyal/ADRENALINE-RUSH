# Local development and testing

## Prerequisites

- Node.js 20.9+ (22 recommended), npm
- A Supabase project for development (simplest), **or** the Supabase CLI local stack (requires Docker)
- PostgreSQL 15+ for the database test suite (any local install or a container)

## Run the app

```bash
npm install
cp .env.example .env.local     # fill in your DEVELOPMENT Supabase project values
# Supabase → SQL Editor → paste supabase/setup.sql → Run
npm run dev                    # http://localhost:3000
```

Then open http://localhost:3000/setup once to create the owner (no token needed under `npm run dev`).
Step-by-step for non-developers: [SETUP_GUIDE.md](SETUP_GUIDE.md).

Using the local Supabase stack instead (Docker required): `npx supabase start`, copy the printed API URL and
keys into `.env.local`, and `npx supabase db reset` to apply migrations.

## Checks

| Command | What it does |
|---------|--------------|
| `npm run lint` | ESLint (Next.js rules) |
| `npm run typecheck` | Regenerates route types, then `tsc --noEmit` (strict) |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | Applies all migrations to a throwaway PostgreSQL database and tests RLS, triggers and functions. Set `TEST_DATABASE_URL` to a superuser URL (default `postgresql://postgres:postgres@localhost:5432/postgres`). |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright against `next start` on port 3100 (run `npm run build` first). Desktop and mobile viewports. |
| `npm run check` | All of the above except e2e |
| `npm run db:setup-sql` | Regenerates `supabase/setup.sql` from the migrations (a test fails if you forget) |
| `npm run db:types` | Regenerates `src/lib/database.types.ts` from the migrations (no Docker needed) |

`tests/db/supabase-stub.sql` recreates just enough of Supabase (roles `anon`/`authenticated`/`service_role`,
`auth.users`, `auth.uid()`) to run the real migrations on plain PostgreSQL. It is never used in production.

## Adding a migration

```bash
npx supabase migration new <name>      # creates supabase/migrations/<timestamp>_<name>.sql
```

Rules: enable RLS on every new table, write policies with `has_permission(org_id, '<key>')`, revoke
function `EXECUTE` from `public, anon, authenticated` and grant only what's needed, pin
`set search_path = ''` on `SECURITY DEFINER` functions, keep the migration idempotent (`if not exists`,
`create or replace`, `drop ... if exists`) because users re-run `setup.sql`, restate the full function grant
list at the end, add tests in `tests/db/`, then `npm run db:setup-sql` and `npm run db:types`.
