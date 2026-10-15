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

### Full HTML & CSS and Marketing Cloud Next courses

`supabase/starter/html-css-and-mc-next.sql` creates (or refreshes) two complete courses built like MCP:
**HTML & CSS for Marketers and Marketing Cloud** (`/courses/html-css`) and **Salesforce Marketing Cloud Next**
(`/courses/marketing-cloud-next`), each with a detailed overview, 14 modules with lesson durations, outcomes,
FAQs, What's included and a cover image. It also gives MCP its cover if it has none. Run the latest
`supabase/setup.sql` first, then paste the file in the SQL Editor and Run. Re-running updates the text and
curriculum but keeps each course's status, prices, schedule and registrations.

**Cover images.** Three covers ship with the website: `/covers/mcp.svg`, `/covers/html-css.svg` and
`/covers/marketing-cloud-next.svg`. Put one of those, or any full `https://` image link, in Admin → Courses →
Edit → Cover image URL. The cover shows on course cards, the home page and the top of the course page.

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
| `cover_image_url` | Course picture | `/covers/html-css.svg` or a full `https://` image link |
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

## Invite your team

Give staff, counselors, instructors or another administrator their own login. Nothing extra to sign
up for: it uses your existing Supabase project (free tier) and, if set up, your email provider.

1. **Settings → Business profile**: tick **Enable staff / counselor accounts** and/or **Enable
   instructor accounts**, then **Save settings**. While a role is switched off, people with that role
   cannot open the dashboard (you can still invite them in advance).
2. **Settings → Team → Invite someone**: enter their name, email and role. Add their WhatsApp number
   if you want to send the link there. Click **Create invitation**.
3. A private link appears. It is emailed automatically if email is set up (see "Email setup" above);
   either way you can click **Copy invite link** or **Share on WhatsApp**. For security the full link
   is shown only once. Lost it? Click **New link** on the pending invitation (the old link stops working).
4. They open the link, check their name, choose a password (at least 12 characters with upper- and
   lower-case letters and a number) and land in the dashboard. If that email already has a login,
   they are asked for its current password instead.

Good to know:

- Links work **once** and expire after **7 days**. **Cancel** stops a link immediately.
- Roles: the built-in **Administrator**, **Staff / Counselor** and **Instructor**, plus any custom roles
  you create (see "Roles and access" below). Menu items they cannot use are hidden, and those pages say
  "no access".
- In the member list you can change a role, **Suspend** (access off, history kept), **Reactivate** or
  **Remove** someone. Under **Permissions** you can allow or block individual permissions for one
  person. You cannot change your own access, and the last owner can never be removed.
- Everyone changes their own name and password under the avatar menu → **My account**.
- Every invitation, role change, suspension, removal and permission change is written to the audit log.
- Edit the invitation email under **Marketing → Emails → Templates → Team invitation**.

## Roles and access

Decide exactly what each person can see and do: **Settings → Roles & access** (owner only).

**Built-in roles**

| Role | What it can do by default | Notes |
| --- | --- | --- |
| Owner | Everything | Cannot be changed. Only an owner can make someone an owner. |
| Administrator | Everything except managing roles | Only the owner can invite, change or remove administrators. |
| Staff / Counselor | Candidates assigned to them, follow-ups, enrollments, sharing demos, viewing courses, batches, calendar and campaigns | No finance, exports or settings. Signs in only while "Enable staff / counselor accounts" is on. |
| Instructor | Courses, demos, **only the batches and classes they teach**, attendance | Signs in only while "Enable instructor accounts" is on. |

Click **Edit permissions** on a built-in role to change it for your business (for example, let staff see
fees). Everyone with that role gets the change straight away. **Reset to default** undoes your changes.

**Make a custom role** (for example for an accountant or a senior trainer):

1. **Settings → Roles & access → New role**. Pick a starting point (**Accounts**, **Counsellor - read only**,
   **Senior instructor**) or start blank.
2. Give it a name and, if you like, a short description (the person sees it on their invitation).
3. Choose **Based on**. This decides the parts permissions cannot: an *Instructor*-based role sees only the
   batches and classes it teaches and can be picked as a batch's instructor; a *Staff*-based role sees all
   batches; an *Administrator*-based role can only be given or changed by the owner. Which sign-in switch
   applies also follows the base. The base cannot be changed later.
4. Tick permissions module by module (Dashboard, Courses, Candidates, Demos, Batches, Calendar & attendance,
   Finance, Marketing & emails, Analytics & reports, Team & settings). The module checkbox selects everything
   in it. Under Candidates choose **All candidates** or **Only candidates assigned to them**. Ticking a "manage"
   permission also ticks the matching "view" one. Sensitive ones (money, exports, settings, team, roles,
   integrations) are marked and listed in a yellow box before you save.
5. **Create role**, then give it to people in **Settings → Team**: pick it in the **Role** list when inviting,
   or in the role list next to an existing member.

Examples:

- **Accounts**: Finance → both boxes, Candidates → All candidates (so fee lists show names; nothing else in
  Candidates), Dashboard if you like. They see Finance (and Candidates read-only), nothing else.
- **Counsellor - read only**: Staff-based, Candidates → Only assigned to them, no "Update candidates".
- **Senior instructor**: Instructor-based, add "Schedule classes" and "Share demos with candidates".

Good to know:

- A one-off exception for one person: **Team → Permissions** next to their name. It overrides their role.
- Nobody except the owner can create or edit roles, or give someone a role with access they do not have
  themselves. You can let administrators manage roles by ticking **Manage roles** on Administrator, but
  they still cannot add permissions they lack or touch administrator roles.
- A role that someone has (or that is on an open invitation) cannot be deleted. Give those people another
  role first.
- Existing members keep exactly the access they had. Every role change is in the audit log.
- Someone without the Dashboard permission goes straight to their first allowed page when they sign in.

## Share demos and resources

**Demos** in the admin menu is your library of demo videos, class recordings, curriculum documents,
project examples and links (YouTube, Vimeo, Google Drive, GitHub or any `https://` link). Nothing to
install or pay for: it works as soon as you have run the latest `supabase/setup.sql`.

1. **Demos → New resource**: paste the link, give it a title, optionally tick the course(s) it belongs to.
   - **Shareable**: can be sent to candidates and gets its own page, e.g. `yoursite.com/r/mcp-demo-class-x7k2`.
     The page plays YouTube/Vimeo/Drive/Loom videos inside it (other links get a button) and shows a
     **Book a free demo** button for the course. It is hidden from Google and has a random ending, so only
     people you send it to find it.
   - **Internal only**: for your team; it can't be shared and has no page.
   - Switch a resource **off** (or set an expiry date) to stop its page and sharing without deleting it.
   - Sharing never changes who can open the original link: for Google Drive choose
     "Anyone with the link", for YouTube "Unlisted", otherwise candidates will see "access denied".
2. **Share**: open a candidate and click **Share demo/resources** (or **Demos → Share** to pick several
   candidates). Tick the resources, pick a message template, check the preview, then:
   - **Open WhatsApp**: opens a chat with the candidate and the message already typed. You press send.
   - **Copy message** / **Copy link**: paste it anywhere (Telegram, LinkedIn, a group).
   - **Send by email**: uses the email setup above (each candidate gets their own copy; you confirm first).
   - Tick **Move to "Demo Shared" status** to update the lead status at the same time.
3. Every share appears on the candidate's **Activity** timeline and under **Demos → Share history**, and
   each resource shows how many times it was shared. Copying or opening WhatsApp is recorded as
   "not confirmed", because only you know whether you pressed send. Emails show "sent" only when the email
   provider accepted them. Candidates marked **Do not contact** cannot be shared with.
4. **Demos → Message templates**: edit the three starter messages or add your own. Placeholders:
   `{{first_name}}`, `{{candidate_name}}`, `{{course_title}}`, `{{course_url}}`, `{{resource_links}}`,
   `{{demo_url}}`, `{{business_name}}`, `{{sender_name}}`.

**WhatsApp country code.** Phone numbers saved without a country code (e.g. `98765 43210`) get the
default code from **Settings → Integrations → WhatsApp** (+91 to start with). Numbers starting with `+`
are used as they are.

**WhatsApp Business API (optional, not built yet).** Click-to-chat above is free and needs no account.
Sending WhatsApp messages automatically (without pressing send yourself) needs the WhatsApp Business
(Cloud) API: a Meta Business account, a phone number verified for WhatsApp Business that is not used in
the normal WhatsApp app, approved message templates, and per-conversation charges from Meta. Tell me if
you want it later; the share screen is ready to add it as one more button.

Free-tier notes: resources are only links and text (no file storage used), so they take almost no space
in the free Supabase database.

## Batches, classes and attendance

Run the latest `supabase/setup.sql` first (SQL Editor → paste → Run). It is safe to run again.

1. **Admin → Batches → New batch.** Pick the course, give it a name (and an optional short code such as
   `MCP-OCT26`), the seats (leave empty for no limit), the class days and times, the time zone (defaults to
   your business time zone) and, if you have one, a default meeting link (Zoom, Meet, Teams…). Choose an
   instructor if someone else teaches it: instructors only see the batches and classes they teach.
2. Open the batch → **Enroll a student**: type a name, email or phone number and click **Enroll**. Enrolling
   is refused when the batch is full, closed, or the student is already in it. The candidate's lead status
   becomes **Enrolled** and the enrollment appears on their profile. You can also enroll from the candidate's
   page (**Enroll in batch**). Change a student's status (on hold, completed, dropped…) or **transfer** them
   to another batch of the same course from the roster. (Fees are set per enrollment under
   Finance, see below.)
3. On the batch page → **Generate classes**: pick the first date and either "For N weeks" or "Until a date".
   Classes are created on the batch's class days at its times. Running it again only adds missing classes.
4. **Admin → Calendar** shows every class and demo session by month or week (on a phone, as a list).
   **New session** adds a one-off class or a **demo session** (not tied to a batch; invite people who booked
   a demo). For the meeting link choose **Paste a link** (always available), **Create Google Meet link** (after
   connecting Google, below) or **No link yet**.
5. Open a session → **Attendance**: mark Present / Late / Absent / Excused (or **Mark all present**) and
   **Save attendance**. It opens 30 minutes before the start. Under **After the session**, paste the recording
   link and mark it completed.
6. Attendance % = (present + late) ÷ (present + late + absent); excused and unmarked classes are not counted.
   It shows per student and for the batch on the batch page, and on each candidate's profile together with
   progress (classes attended ÷ classes scheduled). The dashboard shows **Upcoming sessions**.

## Connect Google Calendar & Meet (optional, free)

Without this, paste any meeting link yourself. With it, a class can get its own Google Meet link and a
Google Calendar event that moves or is deleted when you change the class. Uses a free Google account; the app
only asks for permission to manage **calendar events** (scope `calendar.events`).

**A. Google Cloud project (once, about 10 minutes)**

1. Go to <https://console.cloud.google.com/>, sign in with the Google account whose calendar should hold the
   classes, top bar → project picker → **New project** → name it "Adrenaline Rush" → **Create** → select it.
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (newer consoles call it **Google Auth Platform → Branding /
   Audience**) → **Get started**. App name "Adrenaline Rush", your support email → Audience **External** →
   contact email → agree → **Create**.
4. **Audience → Test users → Add users**: add the Google account you will connect with (yours). Leave the
   publishing status as **Testing** for now.
5. **Data access → Add or remove scopes**: add `https://www.googleapis.com/auth/calendar.events` → **Update →
   Save**.
6. **Clients** (or **Credentials → Create credentials → OAuth client ID**) → Application type **Web
   application** → name "Adrenaline Rush web". Under **Authorized redirect URIs** add both:
   - `http://localhost:3000/api/integrations/google/callback`
   - `https://<your-site>.vercel.app/api/integrations/google/callback` (and your own domain if you use one)

   → **Create**, then copy the **Client ID** and **Client secret**.

**B. Add the keys**

In `.env.local` (restart `npm run dev` afterwards):

```
GOOGLE_CLIENT_ID=the-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=the-client-secret
INTEGRATIONS_ENCRYPTION_KEY=output-of: openssl rand -hex 32
```

Add the same three in **Vercel → Settings → Environment Variables** (tick **Sensitive** for the secret and the
key), then **Redeploy**. `NEXT_PUBLIC_SITE_URL` must be the exact address you open the site at, because the
redirect address is built from it. `INTEGRATIONS_ENCRYPTION_KEY` encrypts the stored Google token; if you leave
it empty a key derived from `SUPABASE_SECRET_KEY` is used. Changing either key later means you click
**Reconnect** once.

**C. Connect**

Admin → **Settings → Integrations → Google Calendar & Meet → Connect Google** → choose the test-user account
→ allow. The row shows **Connected**. Now pick **Create Google Meet link** when creating or editing a session.
If Google is down or refuses, the session is still saved and shows **Retry Google**. Inviting students by email
from Google is optional per session and off by default.

**Testing mode expires after 7 days.** While the consent screen is in *Testing*, Google cancels the
connection after 7 days and the Integrations row shows **Needs reconnecting** (classes keep their links; Meet links for new or
changed classes cannot be created until you reconnect). To stop this: **Audience → Publish app → Confirm**. For a
small business using only its own account you can publish without Google verification; Google shows an
"unverified app" warning on the connect screen, which you accept once (**Advanced → Go to Adrenaline Rush**).

To disconnect: Settings → Integrations → **Disconnect** (existing events stay in your calendar). You can also
remove access at <https://myaccount.google.com/permissions>.

## Fees, payments and expenses

Run the latest `supabase/setup.sql` first (SQL Editor → paste → Run). It is safe to run again. Only the owner,
admins and roles with **finance.view** see anything under **Admin → Finance**; staff and instructors never see
payment records (not even through the database). **finance.manage** is needed to change anything, and CSV export
needs **reports.export** as well.

1. **Fee plan (one per enrollment).** Finance → **Fees & dues** → open a student (or **Fees & payments** on the
   candidate's profile). Enter the agreed fee (it starts from the course price), an optional discount as an
   amount or a % with a reason, and the currency (INR by default). For installments: set **Split into**, the
   **First due** date and click **Split evenly** (whole rupees; any remainder goes on the last one), then adjust
   dates or amounts. The installments must add up to the final fee exactly or the plan is not saved.
2. **Record a payment** (cash, UPI, bank transfer, card, cheque, other) with its reference/UTR/cheque number.
   Pick an installment or leave it on automatic: the money then fills the earliest unpaid installment first.
   Each payment gets the next receipt number (`AR-2026-0001`, `AR-2026-0002`, … restarting each year); open it and
   click **Print or save as PDF** for a receipt. A payment can be marked **pending** (e.g. a cheque) and later
   received or failed.
3. **Refunds** are recorded against a payment, need a reason, and can never exceed what is left of that payment.
4. **Mistakes:** payments and refunds are never deleted; **Void** them with a reason. Every change to money is
   in the audit log.
5. **Overview** (Finance): collections, refunds, net collections, expenses, cash result, outstanding and overdue,
   filtered by date range, course and batch. **Overdue installments** lists who is late with **WhatsApp
   reminder** (opens WhatsApp with a ready message; you press send) and **Email reminder** (sent through your
   email setup). Each reminder is noted on the candidate's timeline (without amounts). The batch page shows a
   fee summary for its students.
6. **Expenses:** Finance → **Expenses** → **Add an expense** (category, amount, vendor, method, optional course,
   batch and receipt link). Categories (Marketing & ads, Software & tools, Trainer payout, Venue, Equipment, Other) can be renamed, added or
   switched off. Expenses can be edited or voided.
7. **Export:** Payments and Expenses each have **Export CSV** with the current filters.

How the numbers are worked out (never stored, always calculated):
- **Net paid** = completed payments − their refunds. **Outstanding** = final fee − net paid.
- An installment is **overdue** when its due date (in your business time zone) has passed and it is not fully
  covered; overdue amount = the unpaid part of those installments.
- **Gross collections** = completed payments in the period (by payment date); **refunds** by refund date;
  **net collections** = gross − refunds; **cash result** = net collections − expenses (recorded, not voided).
- Students whose enrollment is **cancelled** or **dropped** no longer count towards outstanding or overdue, but
  money they paid (and refunds) stays in collections.
- Amounts are kept exactly in paise (no rounding drift); a 10% discount on ₹49,999 is ₹4,999.90.

## Take payments by UPI or bank transfer (free)

Students pay **straight into your bank account** by UPI (Google Pay, PhonePe, Paytm, BHIM, any bank app) or
bank transfer (NEFT / IMPS / RTGS). It is **free**: no gateway, no fees, no sign-up. The trade-off is that
**you confirm each payment by hand** after checking your bank or UPI app. If you want payments confirmed
automatically, use Razorpay instead (next section; it charges a fee per payment). You can use both.

1. **Settings → Payment details** (or Finance → To verify → Payment details). Enter your **UPI ID** (your UPI app
   shows it under your profile, e.g. `yourname@okhdfcbank` or `98xxxxxxxx@ybl`) and the **payee name** it is
   registered to. Optionally add **bank details**: account holder, account number (9–18 digits), IFSC
   (11 characters, the 5th is a zero, e.g. `HDFC0001234`), bank, branch, account type. Add a line of
   **instructions** if you like (e.g. "Add your name in the note"). The **live preview** on the right shows what
   students see, including the QR code. Save.
2. Choose where the details appear: on students' **pay pages** (on), in **reminder messages** (on: reminders then
   include your UPI ID and the pay link), on **public course pages** (off by default: anyone could see them).
3. Optional: **upload your own QR image** (the sticker from your bank or UPI app, PNG/JPG up to 1 MB). The pay page
   always draws its own QR code **with the exact amount filled in**; your image is offered as an alternative and
   cannot carry the amount.
4. Open a student under **Finance → Fees & dues** → card **UPI / bank transfer pay link** → choose **Next
   installment** or **Full balance** → **Make pay link**. Then **Copy pay link**, **Send by WhatsApp** or **Email**.
   From the overview's overdue list you can also use **Pay link** / **WhatsApp pay link** in one click.
   The link is private to that student (it shows only their first name, course and the amount due, never their
   contact details) and is not indexed by search engines. **Make a new link** or **Switch off** stops the old one.
5. The student opens the link on their phone, taps **Pay with UPI app** (or scans the QR from a computer), pays,
   and then enters the **UTR / UPI reference number** (and optionally the date, a screenshot and a note) under
   "Already paid? Tell us". Nothing counts as paid yet.
6. You see a **"payments to verify"** banner on the Finance overview, a badge on the student's fee page, and the
   list under **Finance → To verify**. Check the UTR and amount in your bank/UPI app, then **Approve** (you can
   correct the amount): the payment is recorded as UPI / bank transfer with the UTR as reference, a **receipt** is
   issued and the balance drops. Or **Reject** with a reason. The same UTR cannot be reported or recorded twice.
7. Optional: when you approve, the student gets a **confirmation email** (edit its text under Payment details;
   needs the email setup above). Without an email provider nothing is sent and approval still works.

Good to know: every change to payment details, every pay link made or switched off and every approval/rejection is
kept in the audit log (the account number is masked there). Your full account number is shown only to people with
finance access and on students' pay pages. Pay links are built from a server secret: if you add or change
`PAY_LINK_SECRET` (optional, `openssl rand -hex 32`, in `.env.local` and Vercel), or rotate your Supabase secret key
without it, old pay links stop working; make new ones.

## Online payments with Razorpay (optional)

Without this, record payments by hand as above. With it, a student's fee page gets an **Online payment link** card:
Razorpay hosts the payment page (UPI, cards, net banking), and when the student pays, the payment and its receipt
appear automatically.

1. Create an account at <https://dashboard.razorpay.com/> and stay in **Test Mode** (toggle at the top).
2. **Account & Settings → API Keys → Generate Test Key.** Copy the **Key Id** (`rzp_test_…`) and **Key Secret**
   (shown once).
3. **Account & Settings → Webhooks → Add New Webhook.** Webhook URL:
   `https://<your-site>.vercel.app/api/webhooks/razorpay` (Settings → Integrations shows it with a Copy button).
   Make up a long random **Secret** (e.g. `openssl rand -hex 32`). Active events: **payment_link.paid**,
   **payment_link.partially_paid**, **payment_link.expired**, **payment_link.cancelled**. Save. (A webhook cannot
   reach `localhost`; to test locally use a tunnel such as `ngrok http 3000`, or just test on Vercel.)
4. Add the keys to `.env.local` and to **Vercel → Settings → Environment Variables** (tick **Sensitive**), then
   restart / **Redeploy**:

   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=your-key-secret
   RAZORPAY_WEBHOOK_SECRET=the-secret-you-made-up
   ```

   They are only used on the server; never put them in a `NEXT_PUBLIC_` variable.
5. Settings → Integrations → **Payment gateway** now shows **Test mode**. Open a student under Finance → Fees &
   dues → **Online payment link** → **Link for** the next unpaid installment or **Link for full balance**. Copy
   the link or send it by WhatsApp. Links expire after 30 days; you can cancel one or create a new one.
6. Pay it with Razorpay's test methods (see "Test card details" / "Test UPI" in Razorpay's docs, e.g. UPI id
   `success@razorpay`). Within a few seconds the payment appears with method **Razorpay** and a receipt number.
   Razorpay may retry webhooks; each Razorpay payment is recorded only once.

Going live: complete Razorpay's KYC/activation (business and bank details), generate **Live** keys and a live
webhook with the same URL and events, and replace the three variables in Vercel. Razorpay charges its own fee per
transaction (around 2% for most Indian methods; check their pricing) and pays out to your bank on its settlement
schedule. Refunds of online payments are recorded here by hand; issue the refund itself in the Razorpay dashboard.

## Analytics and reports

Run the latest `supabase/setup.sql` first (SQL Editor → paste → Run; safe to run again). Nothing else is needed:
no extra accounts, keys or paid services. **Admin → Analytics** needs the **reports.view** permission (owner and
admins have it); money figures appear only for people who can also view finance, and every number only counts
records that person is allowed to see.

1. **Pick a period** at the top: This month, Last month, Last 90 days, This year, or your own From/To dates.
   Dates are calendar days in your business time zone (Settings), both days included.
2. **Key numbers:** new leads, demo bookings, demo → enrollment conversion, enrollments, and (with finance
   access) net collections, expenses, cash result and outstanding dues. The money tiles use exactly the same
   calculation as **Payments & Expenses**, so for the same dates they always match; click one to open it there.
3. **Charts:** leads and enrollments over time, money in and out per month, the lead funnel, leads by source and
   UTM campaign, course performance, batch attendance and the most shared resources. Under each chart,
   **Show the numbers** opens the same figures as a table. **How these numbers work** at the bottom explains
   every metric.
4. **Reports** tab: download CSV files (Excel / Google Sheets) for leads, lead sources and campaigns,
   enrollments, attendance, course performance, and, with finance access, payments, refunds and expenses, all
   for the chosen period. Downloading needs **reports.export**; each download is written to the audit log.
5. The **Dashboard** shows this month's key numbers too.

Notes: website visits are not shown because no web analytics is connected (nothing is estimated). Sources come
from the UTM tags of your registration links (or "website", "import", "added by hand"). Exports stop at 20,000
rows; choose a shorter period if a file says it was cut off.

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
| Google: "redirect_uri_mismatch" | The redirect URI in Google Cloud must match `NEXT_PUBLIC_SITE_URL` + `/api/integrations/google/callback` exactly (http vs https, no trailing slash). |
| Google: "Needs reconnecting" every week | The consent screen is still in Testing mode; publish it (see the Google section). |
| Vercel build fails | Open the build log, copy the first error line and send it to me. |
