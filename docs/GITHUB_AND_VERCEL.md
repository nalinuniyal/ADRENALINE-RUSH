# Put Adrenaline Rush on GitHub and Vercel (Mac)

Before you start: `npm run admin:password` has worked and you can sign in at http://localhost:3000/admin.
The live site uses the same Supabase project, so the same login works there.

## Part 1. Push to a private GitHub repository

### 1. Create the empty repository

1. Go to https://github.com/new.
2. Repository name: `adrenaline-rush`. Choose **Private**.
3. Leave "Add a README", ".gitignore" and "license" all **off**.
4. Click **Create repository**. Keep the page open; you need its URL
   (`https://github.com/<your-username>/adrenaline-rush.git`).

### 2. Make a GitHub token (GitHub no longer accepts your password in Terminal)

1. https://github.com/settings/tokens → **Generate new token** → **Generate new token (classic)**.
2. Note: `adrenaline-rush laptop`. Expiration: 90 days (or what you prefer). Tick **repo**.
3. **Generate token** and copy it (starts with `ghp_`). You will paste it once in step 4; the Mac keychain
   remembers it after that. Do not share it in chat.

### 3. Commit the project

In Terminal, inside the project folder (the one with `package.json`):

```bash
cd ~/path/to/adrenaline-rush        # your folder
git init -b main                    # skip if you see "Reinitialized existing Git repository"
git check-ignore .env.local         # must print: .env.local   (means it will NOT be uploaded)
git add -A
git status                          # .env.local must NOT appear in the list
git commit -m "Adrenaline Rush"
```

If `git commit` asks who you are, run these once and repeat the commit:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

If `git check-ignore` printed nothing, stop: check that `.gitignore` is in the folder (it is hidden; press
Cmd+Shift+. in Finder to see it) and that it contains the line `.env*`.

### 4. Upload

```bash
git remote add origin https://github.com/<your-username>/adrenaline-rush.git
git push -u origin main
```

When asked: **Username** = your GitHub username, **Password** = the token from step 2 (nothing shows while
you paste; press Enter).

Refresh the GitHub page. You should see `src`, `supabase`, `docs`, `package.json` and so on, and **no
`.env.local`**.

## Part 2. Host on Vercel

### 5. Import the repository

1. https://vercel.com/signup → **Continue with GitHub** (Hobby plan, free).
2. **Add New… → Project**. If `adrenaline-rush` is not listed, click **Adjust GitHub App Permissions** and
   allow that repository.
3. Click **Import** next to `adrenaline-rush`. Framework Preset shows **Next.js**; leave build settings as they are.

### 6. Environment variables (before clicking Deploy)

Open **Environment Variables** on the same screen and add each row (Name, Value, then **Add**). Copy the
values from your `.env.local`; the URL must be just `https://<ref>.supabase.co`.

| Name | Value | Required? |
|------|-------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Yes |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` (mark **Sensitive**) | Yes |
| `NEXT_PUBLIC_SITE_URL` | leave out for now, added in step 8 | Yes, later |
| `RATE_LIMIT_SALT` | any random text, 16+ characters (mark **Sensitive**). Make one in Terminal: `openssl rand -hex 24` | Recommended |
| `SMTP_HOST` | `smtp.gmail.com` | For emails |
| `SMTP_PORT` | `465` | For emails |
| `SMTP_USER` | your Gmail address | For emails |
| `SMTP_PASSWORD` | the 16-character Gmail app password (mark **Sensitive**) | For emails |
| `EMAIL_FROM` | `Adrenaline Rush <your Gmail address>` | For emails |
| `ADMIN_SETUP_TOKEN` | leave out (you already created your login) | No |

Never add `NEXT_PUBLIC_` in front of the secret key, salt or SMTP password.

### 7. Deploy

Click **Deploy** and wait for "Congratulations". Note your address, e.g. `https://adrenaline-rush.vercel.app`
(Vercel → your project → **Domains** shows it).

If the build fails, open the build log, copy the first red error line and send it to me.

### 8. Tell the app and Supabase its address

1. Vercel → project → **Settings → Environment Variables** → add `NEXT_PUBLIC_SITE_URL` =
   `https://adrenaline-rush.vercel.app` (your address, no `/` at the end).
2. Vercel → **Deployments** → the latest one → **⋯** → **Redeploy**. (Every env change needs a redeploy.)
3. Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://adrenaline-rush.vercel.app`
   - Redirect URLs → **Add URL**: `https://adrenaline-rush.vercel.app/**` (keep the localhost one too).
4. Optional, faster pages: Vercel → **Settings → Functions → Function Region** → the region nearest your
   Supabase project (e.g. Mumbai `bom1` for ap-south-1) → Save → Redeploy.

### 9. Check the live site

| Open | You should see |
|------|----------------|
| `https://<your-address>/api/health` | `"status":"ok"` and `"database":"ok"` |
| `https://<your-address>/` | Your home page, footer with no admin links |
| `https://<your-address>/admin` | Sign-in page. Use the same email and password as on your laptop. |
| Admin → Marketing & Emails → Settings | Provider shows connected; click **Send test email** |
| `https://<your-address>/courses/mcp` (after publishing) | The MCP course with "Book a free demo" |

Forgot the password later? Run `npm run admin:password` on your laptop; it changes it for the live site too.

## Updating later

```bash
git add -A
git commit -m "Describe the change"
git push
```

Vercel redeploys automatically. If a new version comes with a changed `supabase/setup.sql`, run it in the
Supabase SQL Editor first.

## If something goes wrong

| Problem | Fix |
|---------|-----|
| `git push` says "Authentication failed" | Use the token as the password, not your GitHub password. If an old password is saved: Keychain Access → search `github.com` → delete → push again. |
| `remote origin already exists` | `git remote set-url origin https://github.com/<your-username>/adrenaline-rush.git` |
| `.env.local` shows on GitHub | Run `git rm --cached .env.local`, commit, push, then create a new secret key in Supabase (Project Settings → API Keys), delete the old one, and update `.env.local` and Vercel. |
| Live site: "Invalid public environment configuration" | A `NEXT_PUBLIC_...` value is missing or mistyped in Vercel; fix it and Redeploy. |
| `/api/health` shows `database: error` | Wrong Supabase keys in Vercel, or `setup.sql` not run, or the project is paused (Supabase → Restore project). |
| Sign-in says "server cannot reach Supabase Auth" | Same as above: check the three Supabase values in Vercel and Redeploy. |
