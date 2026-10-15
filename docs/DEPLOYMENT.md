# Hosting and deployment: Supabase + Vercel

This takes a fresh clone to a live site. Every step is repeatable. Nothing here needs production secrets
to be pasted into chat or committed to Git.

## 0. Accounts you need (all can be free)

| Service | Why | Free plan | Limits to know |
|---------|-----|-----------|----------------|
| GitHub | Source code; Vercel deploys from it | Free, private repos included | None that matter here |
| Supabase | Postgres database + login | Free plan | 500 MB database, 2 free projects. **The project pauses after about a week with no activity** (restore it from the dashboard with one click; data is kept). **No automatic backups**, so run the free manual backup in section 8 weekly. |
| Vercel | Hosts the website | Hobby (free) | Vercel's terms allow Hobby only for **non-commercial / personal** use. Fine for building and trying it out; if the site starts taking real paying students, Vercel expects the Pro plan. Bandwidth and function limits are far above what this app needs. |
| Domain | Your own web address | Optional | A custom domain costs money at any registrar. The free `your-project.vercel.app` address works without one. |

Later integrations also have free options: Google Calendar/Meet API (free with a Google account) and an email
provider such as Resend (free tier). Nothing in Phase 1 needs a paid service.

Tools on your machine: Node.js 20.9+ (22 recommended), Git, and `npx` (bundled with Node).

## 1. Push the code to GitHub

```bash
cd adrenaline-rush
git init -b main            # skip if already a repo
git add -A
git commit -m "Adrenaline Rush: Phase 0-1 foundation"
git remote add origin https://github.com/<you>/adrenaline-rush.git
git push -u origin main
```

`.env.local` is ignored by Git; only `.env.example` (placeholders) is committed.

## 2. Create the Supabase project

1. supabase.com → **New project**. Pick a region near your users (for India: **Mumbai / ap-south-1**).
2. Save the **database password** in a password manager. You need it for `supabase link` and backups.
3. **Project Settings → API Keys**: note the **Publishable key** (`sb_publishable_…`) and create/copy a
   **Secret key** (`sb_secret_…`). If your project only shows legacy keys, use `anon` and `service_role`.
   The **Project URL** is `https://<project-ref>.supabase.co`.
4. **Authentication → Sign In / Providers**: keep **Email** enabled and turn **off "Allow new users to sign
   up"**. Accounts are only created by `/setup` (and, later, invitations).
5. **Authentication → URL Configuration**: Site URL = your production URL (e.g.
   `https://adrenalinerush.in`, or the `*.vercel.app` URL until the domain is ready). Add
   `https://<your-domain>/**` and `http://localhost:3000/**` to Redirect URLs.
6. In the Authentication password settings, set the minimum length to **12** and require letters and digits
   (the app enforces the same rule at setup).

## 3. Set up the database

Supabase → **SQL Editor** → **New query** → paste the whole of `supabase/setup.sql` → **Run**. Expected:
"Success. No rows returned". The file is idempotent: run the newer file the same way after every update.
It never inserts sample data.

(`supabase/setup.sql` is generated from `supabase/migrations/*.sql` by `npm run db:setup-sql`. If you prefer
the Supabase CLI, `npx supabase link` + `npx supabase db push` applies the same migrations.)

## 4. Create the Vercel project

1. vercel.com → **Add New → Project** → import the GitHub repo. Framework is detected as **Next.js**; keep
   the default build command (`next build`) and output.
2. **Settings → Environment Variables** (scope: Production and Preview unless noted):

| Name | Value | Notes |
|------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Public by design |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` | No trailing slash |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Mark **Sensitive**. Never prefix with `NEXT_PUBLIC_` |
| `ADMIN_SETUP_TOKEN` | optional, 32+ random characters | If set, `/setup` asks for it instead of the secret key |
| `RATE_LIMIT_SALT` | optional, 16+ random characters | Defaults to a value derived from the secret key |

3. **Settings → Functions → Function Region**: choose the region closest to your Supabase project (Mumbai,
   `bom1`, for ap-south-1). Every request talks to the database, so this matters for speed.
4. **Deploy.** `next build` type-checks the project and fails on any TypeScript error.

Preview deployments: if Preview uses the same Supabase project, previews touch production data. For safety
create a second Supabase project for previews/tests and set Preview-scoped variables to it.

## 5. Create the owner account (once)

Either run `npm run admin:password` locally (uses `.env.local`; also resets forgotten passwords), or open
`/setup` on the site: under `npm run dev` no proof is needed; on a deployed site the form asks for the
Supabase secret key (or `ADMIN_SETUP_TOKEN` if you set one). `/setup` stops working once a business exists.
The admin area is `/admin`; nothing public links to it. Change email/password in Settings → Sign-in details.

## 6. Custom domain

1. Vercel → **Settings → Domains** → add `yourdomain.com` (and `www`). Vercel shows the exact DNS records
   (an `A` record for the apex and a `CNAME` for `www`, or nameserver delegation). Add them at your registrar.
2. Wait for Vercel to show the domain as valid; HTTPS certificates are issued automatically.
3. Update `NEXT_PUBLIC_SITE_URL` in Vercel and **Site URL / Redirect URLs** in Supabase to the new domain,
   then redeploy.

## 7. Production smoke test

| Check | Expected |
|-------|----------|
| `curl -s https://<site>/api/health` | `{"status":"ok","database":"ok",...}` (HTTP 200) |
| Open `/admin` in a private window | Redirects to `/login?next=/admin` |
| Sign in with the owner account | Dashboard loads with your business name |
| Change a setting and save | "Settings saved." and value persists after reload |
| Sign out, press Back | Redirected to `/login`, no admin content |
| `/setup` | 404 |

Automated version against the live site (use a **test** project's owner, not production credentials):

```bash
E2E_BASE_URL=https://<preview-or-test-url> E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e
```

## 8. Backups and recovery

- **Free plan: you are the backup.** Supabase Free has no automatic backups, so run the three commands below
  at least weekly (they are free). Supabase Pro adds automated daily backups if you upgrade later.
- **Your own off-site copy** (recommended weekly, and before risky migrations):

```bash
npx supabase db dump --linked -f backups/$(date +%F)-schema.sql
npx supabase db dump --linked --data-only -f backups/$(date +%F)-data.sql
npx supabase db dump --linked --role-only -f backups/$(date +%F)-roles.sql
```

  Store dumps encrypted (they contain candidate personal data) and outside the Git repo.
- **Restore into a new project**: create the project, run `supabase/setup.sql` in its SQL Editor (schema), then
  load data with `psql "<connection string from Project Settings → Database>" -f <date>-data.sql`. Point
  Vercel's variables at the new project and redeploy. Practise this once on a scratch project.
- Auth users live in the `auth` schema. Open the data dump and confirm it contains `auth.users` rows; if it
  does not, re-run it with `--schema auth,public`. Uploaded files (Storage, from Phase 4) need a separate copy.

## 9. Rolling back

- App: Vercel → Deployments → pick the last good deployment → **Promote to Production** (instant).
- Database: migrations are forward-only. Write a new migration that reverses the change; for data loss,
  restore from backup. Always take a backup before running a new `setup.sql` in production.

## 10. Observability

- Vercel → **Logs** shows server logs. The app writes structured JSON lines (`level`, `msg`, error `code`)
  and never logs passwords, tokens or candidate personal data.
- Supabase → **Logs** for Postgres/Auth/API errors.
- Point an uptime monitor (e.g. any free uptime service) at `/api/health`.
