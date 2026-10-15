#!/usr/bin/env node
/**
 * Set (or reset) the owner login for Adrenaline Rush.
 *
 *   npm run admin:password
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local (or the
 * environment). It:
 *   - creates the login if the email does not exist yet, or sets a new password
 *     (and confirms the email) if it does;
 *   - creates the business on first use (same as the /setup page), otherwise
 *     makes sure this person is an active owner of it.
 * Nothing is printed or stored except a short result line.
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "../src/lib/supabase-url.mjs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]]) continue;
    const value = /^['"]/.test(m[2]) ? m[2].replace(/^(['"])(.*)\1$/, "$2") : m[2].replace(/\s+#.*$/, "");
    process.env[m[1]] = value;
  }
}

export function passwordProblems(pw) {
  const problems = [];
  if (pw.length < 12) problems.push("at least 12 characters");
  if (pw.length > 128) problems.push("at most 128 characters");
  if (!/[a-z]/.test(pw)) problems.push("a lower-case letter");
  if (!/[A-Z]/.test(pw)) problems.push("an upper-case letter");
  if (!/[0-9]/.test(pw)) problems.push("a number");
  return problems;
}

function ask(question, { hidden = false, env } = {}) {
  // Non-interactive use (tests, CI): ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, BUSINESS_NAME.
  if (env && process.env[env] !== undefined) return Promise.resolve(process.env[env].trim());
  const muted = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: hidden ? muted : process.stdout, terminal: hidden && process.stdin.isTTY });
  if (hidden) process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question(hidden ? "" : question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Plain-language reason for a failed setup_required() call. Exported for tests. */
export function describeProbeError(error) {
  const msg = `${error?.message ?? ""} ${error?.details ?? ""}`;
  if (/invalid path/i.test(msg)) {
    return "Supabase did not recognise the address. Check NEXT_PUBLIC_SUPABASE_URL is exactly https://<project-ref>.supabase.co with nothing after it.";
  }
  if (/invalid api key|no api key|unregistered api key|jwt|jws|unauthori[sz]ed/i.test(msg) || error?.code === "401") {
    return "Supabase rejected SUPABASE_SECRET_KEY. Copy a secret key (sb_secret_...) from Project Settings > API Keys for this same project.";
  }
  if (error?.code === "PGRST202" || /could not find the function|schema cache/i.test(msg)) {
    return "the tables are not there yet. Paste supabase/setup.sql into Supabase > SQL Editor and click Run, then try again.";
  }
  if (/fetch failed|enotfound|getaddrinfo|econnrefused|network/i.test(msg)) {
    return "could not connect. Check NEXT_PUBLIC_SUPABASE_URL, your internet connection, and that the project is not paused (Supabase dashboard > Restore project).";
  }
  return `${error?.message || error?.code || "unknown error"}. Check both values in .env.local and that supabase/setup.sql has been run.`;
}

async function main() {
  loadEnvFile(".env.local");
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
  if (!rawUrl || !secret) {
    console.error(
      existsSync(".env.local")
        ? "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local."
        : "No .env.local in this folder. Run this from the adrenaline-rush folder after creating .env.local (docs/SETUP_GUIDE.md, step 2).",
    );
    process.exit(1);
  }
  const normalized = normalizeSupabaseUrl(rawUrl);
  if (!normalized.ok) {
    console.error(`NEXT_PUBLIC_SUPABASE_URL in .env.local is not right: ${normalized.reason}.`);
    console.error("Copy the Project URL from Supabase > Project Settings > Data API. It looks like https://abcdefghijklmnop.supabase.co");
    process.exit(1);
  }
  const url = normalized.url;
  console.log(`Supabase project: ${url}`);
  if (normalized.changed) {
    console.log(`(Your .env.local has "${rawUrl.trim()}". The app now copes with that, but you can change it to ${url}.)`);
  }
  if (!secret.startsWith("sb_secret_") && !secret.startsWith("eyJ")) {
    console.error("SUPABASE_SECRET_KEY should start with sb_secret_ (Supabase > Project Settings > API Keys > Secret keys).");
    process.exit(1);
  }
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: needsSetup, error: probeError } = await admin.rpc("setup_required");
  if (probeError) {
    console.error(`Could not use the database: ${describeProbeError(probeError)}`);
    process.exit(1);
  }

  console.log("Set the admin (owner) login for Adrenaline Rush.\n");
  const email = (await ask("Admin email: ", { env: "ADMIN_EMAIL" })).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("That doesn't look like an email address.");
    process.exit(1);
  }
  const password = await ask("New password (hidden): ", { hidden: true, env: "ADMIN_PASSWORD" });
  const problems = passwordProblems(password);
  if (problems.length) {
    console.error(`Password needs ${problems.join(", ")}.`);
    process.exit(1);
  }
  const confirm = await ask("Repeat password: ", { hidden: true, env: "ADMIN_PASSWORD" });
  if (confirm !== password) {
    console.error("Passwords do not match.");
    process.exit(1);
  }

  let user = await findUserByEmail(admin, email);
  let fullName = user?.user_metadata?.full_name;
  if (user) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true, ban_duration: "none" });
    if (error) throw new Error(`Could not update the password: ${error.message}`);
  } else {
    fullName = await ask("Your full name: ", { env: "ADMIN_NAME" });
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (error || !data.user) throw new Error(`Could not create the login: ${error?.message}`);
    user = data.user;
  }

  if (needsSetup) {
    const businessName = (await ask("Business name [Adrenaline Rush]: ", { env: "BUSINESS_NAME" })) || "Adrenaline Rush";
    const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "business";
    const { error } = await admin.rpc("bootstrap_organization", {
      p_user_id: user.id,
      p_org_name: businessName,
      p_org_slug: slug,
      p_full_name: fullName || email.split("@")[0],
    });
    if (error) throw new Error(`Could not create the business: ${error.message}`);
  } else {
    const { data: org, error: orgError } = await admin.from("organizations").select("id").order("created_at").limit(1).single();
    if (orgError || !org) throw new Error("Could not find the business.");
    const { data: existing } = await admin.from("organization_memberships").select("id, role, status").eq("organization_id", org.id).eq("user_id", user.id).maybeSingle();
    if (!existing) {
      const { error } = await admin.from("organization_memberships").insert({ organization_id: org.id, user_id: user.id, role: "owner", status: "active" });
      if (error) throw new Error(`Could not give owner access: ${error.message}`);
    } else if (existing.role !== "owner" || existing.status !== "active") {
      const { error } = await admin.from("organization_memberships").update({ role: "owner", status: "active" }).eq("id", existing.id);
      if (error) throw new Error(`Could not give owner access: ${error.message}`);
    }
  }

  console.log("\nDone. Sign in at <your site>/admin with that email and password.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
