# Authentication and authorization

## Sign-in

- Email + password via Supabase Auth. Sessions live in HTTP-only cookies managed by `@supabase/ssr`.
- `src/proxy.ts` refreshes the session on each request and redirects signed-out visitors away from `/admin/*`.
- The session is verified server-side with `supabase.auth.getClaims()` (validates the JWT), never trusted
  from the client.
- Login is rate limited per IP (20 / 15 min) and per email (8 / 15 min) in Postgres. Failures return a
  generic message. Supabase Auth applies its own limits too.
- **Public signup is disabled** (`supabase/config.toml` locally; you must also switch it off in the hosted
  project, see DEPLOYMENT.md).

## First administrator

1. Set `ADMIN_SETUP_TOKEN` (32+ random characters) in the server environment.
2. Open `/setup`, paste the token, enter the business name and owner details.
3. The server checks the token in constant time, creates the auth user with the secret key, then calls
   `bootstrap_organization()` which creates the organization and owner membership. That function is
   executable only by the service role and refuses to run once any organization exists.
4. `/setup` returns 404 afterwards. Remove `ADMIN_SETUP_TOKEN` from the environment.

## Roles and permissions

| Role | Default access |
|------|----------------|
| Owner | Everything (cannot be overridden) |
| Administrator | Everything; cannot create/modify owner or admin memberships |
| Staff / Counselor | Dashboard, view courses, **assigned** candidates, update candidates, view/share resources, view batches, manage enrollments, view calendar, view marketing. **No finance, no exports, no settings.** |
| Instructor | Dashboard, view courses, view/manage resources, view batches, view calendar, record attendance |

Staff and instructor roles only work when switched on in Settings (`staff_enabled`, `instructors_enabled`);
otherwise those members have no access at all.

The full permission list is in `src/lib/auth/permissions.ts` and seeded in the first migration (a unit test
keeps them in sync). The owner/admin can grant or revoke individual permissions per member through
`membership_permission_overrides` (Settings → Team → Permissions). Only the owner changes administrators'
overrides, and nobody can grant a permission they do not hold.

## Team invitations

Owners/admins with `members.manage` invite people from Settings → Team. The link carries a 256-bit random
token; only its sha256 is stored. Links are single-use, expire after 7 days, can be cancelled, and are
rate limited on the public `/invite/[token]` page. Accepting creates a confirmed Supabase login (or, if the
email already has one, requires its current password) and activates the membership in one database
function that only the service role can call.

## Enforcement layers

1. **Proxy** (`src/proxy.ts`) — optimistic redirect only.
2. **Data access layer** (`src/lib/auth/session.ts`) — `requireAccess(anyOf)` in every protected page,
   `assertPermission(anyOf)` in every Server Action. Navigation is filtered by permission, but hiding a link
   is never the protection.
3. **Row Level Security** — every table has RLS on (a test fails if one doesn't). Policies call
   `has_permission(org_id, key)`; `anon` has no table grants on private tables.

## Secrets

| Variable | Where it may be used |
|----------|---------------------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server (public by design; RLS protects data) |
| `SUPABASE_SECRET_KEY` | Server only, via `src/lib/env.server.ts` (`server-only` import makes client use a build error) |
| `ADMIN_SETUP_TOKEN`, `RATE_LIMIT_SALT` | Server only |

The build was checked to contain no secret values in `.next/static`.

## Tests that prove it

- `tests/db/foundation.rls.test.ts` — anon cannot read any private table; outsiders see nothing; staff cannot
  see finance permissions, settings or audit log, or promote themselves; admins cannot create owners; the last
  owner cannot be removed; audit log is immutable; RLS is on for every table.
- `tests/db/rate-limit.test.ts` — limiter behaviour and that only the service role can use it.
- `tests/e2e/public-and-guards.spec.ts` — visitors are redirected from `/admin/*` with no admin HTML in the
  response; login validation; security headers; health endpoint leaks nothing.
- `tests/e2e/admin-signin.spec.ts` — real owner sign-in and sign-out (runs when `E2E_ADMIN_EMAIL` and
  `E2E_ADMIN_PASSWORD` are set against a test Supabase project).
