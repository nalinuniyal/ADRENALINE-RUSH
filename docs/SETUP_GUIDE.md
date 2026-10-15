# Step-by-step: run locally, push to GitHub, host on Vercel

This is the simplest path. No Supabase CLI, no Docker. You need three values from Supabase and nothing else.

## What you need installed

- **Node.js 22** (or 20.9+): https://nodejs.org → LTS installer. Check with `node -v`.
- **Git**: https://git-scm.com. Check with `git --version`.
- A code editor (VS Code is fine).

## Step 1. Set up the database (2 minutes)

1. Open your project at https://supabase.com/dashboard.
2. Left menu → **SQL Editor** → **New query**.
3. Open the file `supabase/setup.sql` from this project in your editor, select all, copy, and paste it into
   the SQL Editor.
4. Click **Run**. You should see **"Success. No rows returned"**.

It is safe to run again. When you download a newer version of this project, run its `setup.sql` the same
way; your existing data is kept.

Then two settings in Supabase:

- **Authentication → Sign In / Providers → Email**: keep Email on, turn **off "Allow new users to sign up"**.
  (Team accounts are created by the app, not by strangers.)
- **Authentication → URL Configuration**: Site URL `http://localhost:3000` for now. Under Redirect URLs add
  `http://localhost:3000/**`. You will add your Vercel address in step 5.

If you see an error in the SQL Editor, copy the first red line of the message and send it to me.

## Step 2. Add your keys locally

1. Unzip the project and open a terminal in the `adrenaline-rush` folder.
2. Copy the example file:
   - Mac/Linux: `cp .env.example .env.local`
   - Windows (PowerShell): `Copy-Item .env.example .env.local`
3. Open `.env.local` and fill in **only these three** (Supabase → **Project Settings → API Keys**, and the
   Project URL from **Project Settings → Data API**):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

The URL is only `https://<your-project-ref>.supabase.co`, with nothing after `.co` (no `/rest/v1`, no
trailing `/`). Leave the others empty. `.env.local` is ignored by Git, so it never gets uploaded. Never paste the secret key
anywhere else (chat, GitHub, screenshots). If it was ever shared, create a new secret key in Supabase
(**Project Settings → API Keys**), delete the old one, and update `.env.local` and Vercel.

## Step 3. Run it on your computer

```bash
npm install
npm run dev
```

Open http://localhost:3000. You should see the home page.

### Create your admin login (once)

Your admin area is at **/admin** (for example `http://localhost:3000/admin`, later
`https://your-site.vercel.app/admin`). It is not linked from the public website; only people who know the
URL and have a login can use it.

Pick **one** of these:

- **Easiest: from your computer.** In the project folder run `npm run admin:password`. It asks for your
  email, a password (12+ characters with upper-case, lower-case and a number), your name and the business
  name, and sets everything up. Run it again any time to **reset a forgotten password**.
- **In the browser:** open `/setup`. On your computer (`npm run dev`) no extra code is needed. On the live
  site it asks for your **Supabase secret key** to prove you own the site (it is checked on the server and
  not stored). This page disappears once the first login exists.

Then sign in at `/admin`. To change your email or password later: **Settings → Sign-in details**.

If sign-in fails:

| Message | Fix |
|---------|-----|
| `npm run admin:password` says "Invalid path specified in request URL" or "Supabase did not recognise the address" | `NEXT_PUBLIC_SUPABASE_URL` has extra text after `.supabase.co` (for example `/rest/v1/`). Set it to exactly `https://<project-ref>.supabase.co` in `.env.local` (and Vercel). The latest version also strips this automatically. |
| `npm run admin:password` says "Supabase rejected SUPABASE_SECRET_KEY" | Copy a **secret** key (`sb_secret_...`) from Project Settings → API Keys of the same project. |
| `npm run admin:password` says "the tables are not there yet" | Run `supabase/setup.sql` in the SQL Editor (step 1). |
| "The email or password is incorrect." | Run `npm run admin:password` with the same email to set a new password. |
| "server cannot reach Supabase Auth" | `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is wrong (in `.env.local` locally, or in Vercel → Settings → Environment Variables; redeploy after changing). |
| "Too many sign-in attempts" | Wait 15 minutes. |
| You sign in but see "No access" | Run `npm run admin:password` with that email; it makes the account an owner. |

### Quick test checklist

| Try this | You should see |
|----------|----------------|
| http://localhost:3000/api/health | `"status":"ok","database":"ok"` |
| Dashboard → Settings | Save your contact email and time zone |
| Courses → New course | Fill in title and price, save, then **Publish** |
| Open http://localhost:3000/courses | Your course is listed |
| Open the course, fill the registration form | "Thank you" page |
| Back in the dashboard → Candidates | The person you just registered, with the course |
| Register again with the same email | Still one candidate, with a second registration marked duplicate |
| Log out, open http://localhost:3000/admin | Sent to the sign-in page |

## Step 4. Push to GitHub

Detailed Mac walkthrough with every Vercel variable: [GITHUB_AND_VERCEL.md](GITHUB_AND_VERCEL.md).

1. github.com → **New repository** → name it `adrenaline-rush`, **Private**, do not add a README.
2. In the project folder:

```bash
git init -b main
git add -A
git commit -m "Adrenaline Rush"
git remote add origin https://github.com/<your-username>/adrenaline-rush.git
git push -u origin main
```

(If the folder already has a `.git` folder from the zip, skip `git init`.) Check on GitHub that there is
**no** `.env.local` in the file list.

## Step 5. Host on Vercel

1. vercel.com → sign in with GitHub → **Add New → Project** → import `adrenaline-rush`.
2. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | same as `.env.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same as `.env.local` |
| `SUPABASE_SECRET_KEY` | same as `.env.local` (tick **Sensitive**) |
| `NEXT_PUBLIC_SITE_URL` | your Vercel address, e.g. `https://adrenaline-rush.vercel.app` (no trailing slash). Add it after the first deploy if you don't know it yet, then redeploy. |

3. Click **Deploy**. It takes about two minutes.
4. Back in Supabase → **Authentication → URL Configuration**: set Site URL to your Vercel address and add
   `https://<your-vercel-address>/**` to Redirect URLs.
5. Optional but faster: Vercel → **Settings → Functions → Function Region** → pick the region nearest your
   Supabase project (Mumbai `bom1` if Supabase is in ap-south-1), then redeploy.

Open `https://<your-vercel-address>/api/health`, then `/admin` and sign in with the login you created in step 3.

From now on, every `git push` to `main` redeploys the site automatically.

## Launch your MCP course

1. Optional head start: Supabase → SQL Editor → paste `supabase/starter/mcp-course.sql` → Run. It creates
   a **draft** course at `/courses/mcp` with a starter curriculum outline and the five "What's included"
   items. (Or create the course yourself in Admin → Courses → New course.)
2. Admin → **Courses** → open it. Edit the text, curriculum, **What's included** (interview practice,
   placement support, one-to-one discussions, hands-on projects, post-course support, or your own), fee or
   "Contact for fees", the **badge** (e.g. "Next free demo: Saturday 11 AM") and the button label.
3. **Registration form** tab: the form is short by default (name, email, phone, role, experience, how they
   heard about you, consent). Switch extra fields on or add your own questions.
4. Click **Publish**, then **Copy public link** and share `https://<your-site>/courses/mcp` in your
   communities and groups. Candidates land there and book a free demo.
5. Admin → Settings → **Website**: set the headline, contact details, WhatsApp, social links, footer text,
   and pick MCP as the **featured course** so the home page button goes straight to it. Untick "Show the
   course catalogue" if you want only the featured course promoted.
6. Each booking appears in **Candidates**, and (after the email setup below) you and the candidate both get
   an email. Edit those emails in **Marketing → Emails**.

For Marketing Cloud next: **Clone** the MCP course, change the title, link and content, publish, and share
its link. Demo emails work for every course automatically.

### Sample courses and editing them in Supabase

`supabase/starter/sample-courses.sql` adds four published sample courses (MCP, Marketing Cloud Engagement,
Data Cloud, HTML & CSS) with categories, What's included, FAQs and a curriculum. Paste it in the SQL Editor
and Run. Re-running skips courses that already exist, so your edits are kept.

To edit directly in Supabase: **Table Editor → `courses`**, double-click a cell, change it, **Save**. Changes
show on the website straight away.

| Column | What it is | Format |
|--------|------------|--------|
| `title`, `short_description`, `description`, `who_is_it_for`, `prerequisites` | Course text | Plain text |
| `status` | `published` (visible) or `draft` (hidden) | Pick from the list |
| `list_price`, `discounted_price`, `show_price` | Fee; `show_price` false shows "Contact for fees" | Numbers; true/false |
| `duration_text`, `level`, `highlight_badge`, `cta_label` | "6 weeks · weekends", badge above the title, button text | Plain text (badge up to 80, button up to 40 characters) |
| `learning_outcomes` | "What you'll learn" list | `{"First point","Second point"}` |
| `inclusions` | What's included cards | `[{"title":"Interview practice","description":"...","icon":"mic"}]` |
| `faqs` | Questions and answers | `[{"q":"Question?","a":"Answer."}]` |
| `slug` | The link, `/courses/<slug>` | lowercase-with-dashes; changing it breaks links you already shared |

Curriculum is in `course_modules` (one row per module, ordered by `position`) and `lessons` (linked by
`module_id`). Admin → Courses edits all of this with forms and checks the formats for you, so use it for
anything bigger than a text change.

## Email setup (optional, free)

Without this, everything still works: emails are recorded in **Marketing → Emails → Email log** as
"Not sent". To actually send them, pick one option.

**Gmail (simplest, no domain needed, about 500 emails/day)**

1. Google Account → **Security** → turn on **2-Step Verification**.
2. Google Account → **Security** → **2-Step Verification** → **App passwords** → create one (name it
   "Adrenaline Rush") and copy the 16-character password.
3. Add to `.env.local`, and the same values in Vercel → Settings → Environment Variables (tick
   **Sensitive** for the password), then redeploy:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=you@gmail.com
   SMTP_PASSWORD=the-16-character-app-password
   EMAIL_FROM=Adrenaline Rush <you@gmail.com>
   ```

**Resend (alternative, 3,000 emails/month free)**: create an API key at resend.com and set
`RESEND_API_KEY` (and `EMAIL_FROM`). Until you verify a domain you own in Resend, it delivers **only to
the address you signed up to Resend with** — candidates will not get emails. If both are set, Gmail/SMTP is used.

Make sure `NEXT_PUBLIC_SITE_URL` is your live address: links and images in emails use it.

Then open **Marketing → Emails → Settings**, check the provider shows as connected, set who receives
"new demo booking" emails, and click **Send test email**. Edit the email text and images under
**Templates**; choose which email goes to whom, and for which course, under **Automations**.

## Updating to a newer version

1. Replace the project files with the new zip (keep your `.env.local`).
2. Supabase → SQL Editor → paste the new `supabase/setup.sql` → Run.
3. `npm install`, `npm run dev`, test.
4. `git add -A && git commit -m "Update" && git push`. Vercel redeploys.

## Common problems

| Problem | Fix |
|---------|-----|
| "Invalid public environment configuration" | A value in `.env.local` (or Vercel) is missing or mistyped. Restart `npm run dev` after editing `.env.local`. |
| "The database is not set up yet" / health shows `database: error` | Run `supabase/setup.sql` in the SQL Editor (step 1). |
| `/setup` shows "This page doesn't exist" | Setup is already done. Sign in at `/admin`; forgot the password? `npm run admin:password`. |
| Supabase project paused (free plan, after a week idle) | Supabase dashboard → **Restore project**. Data is kept. |
| Vercel build fails | Open the build log, copy the first error line and send it to me. |
