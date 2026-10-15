"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv, setupMode } from "@/lib/env.server";
import { safeNextPath } from "@/lib/auth/routes";
import { checkRateLimit, clientIp, DB_UNAVAILABLE_MESSAGE, RATE_LIMITS } from "@/lib/security/rate-limit";
import { safeEqual } from "@/lib/security/tokens";
import { loginSchema, setupSchema } from "@/lib/validation/auth";

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: Record<string, string>;
};

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  // Structured, PII-free logs (no emails, passwords or tokens).
  console[level === "info" ? "log" : level](JSON.stringify({ level, msg, ...extra }));
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values: { email } };
  }

  const ip = await clientIp();
  const [ipRes, emailRes] = await Promise.all([
    checkRateLimit(RATE_LIMITS.loginPerIp, ip),
    checkRateLimit(RATE_LIMITS.loginPerEmail, parsed.data.email),
  ]);
  if (ipRes === "unavailable" || emailRes === "unavailable") {
    return { error: DB_UNAVAILABLE_MESSAGE, values: { email } };
  }
  if (ipRes !== "ok" || emailRes !== "ok") {
    log("warn", "login rate limited");
    return { error: "Too many sign-in attempts. Please wait 15 minutes and try again.", values: { email } };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    log("info", "login failed", { status: error.status, code: error.code });
    // Supabase only reports these after the password matched, so they reveal nothing to a guesser.
    if (error.code === "email_not_confirmed") {
      return { error: "This account's email is not confirmed. Run `npm run admin:password` to confirm it and set a new password.", values: { email } };
    }
    if (error.code !== "invalid_credentials" && (error.status === undefined || error.status >= 500 || error.status === 401)) {
      return { error: "Sign-in is not working because the server cannot reach Supabase Auth. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.", values: { email } };
    }
    return { error: "The email or password is incorrect.", values: { email } };
  }

  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type SetupResult = { ok: false; error?: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * One-time creation of the first owner and the business. Guarded by:
 *  1. a server secret the person must know (ADMIN_SETUP_TOKEN, or the
 *     Supabase secret key itself), compared in constant time, or local
 *     development mode (see setupMode),
 *  2. a per-IP rate limit,
 *  3. the database function, which refuses once any organization exists.
 */
export async function completeSetup(input: unknown): Promise<SetupResult> {
  const env = serverEnv();
  const mode = setupMode();

  const rate = await checkRateLimit(RATE_LIMITS.setupPerIp, await clientIp());
  if (rate === "unavailable") return { ok: false, error: DB_UNAVAILABLE_MESSAGE };
  if (rate === "limited") return { ok: false, error: "Too many setup attempts. Please wait an hour and try again." };

  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const data = parsed.data;

  const expected = mode === "token" ? env.ADMIN_SETUP_TOKEN : mode === "secret-key" ? env.SUPABASE_SECRET_KEY : undefined;
  if (expected !== undefined && !safeEqual(data.setupToken.trim(), expected)) {
    log("warn", "setup token mismatch");
    return { ok: false, fieldErrors: { setupToken: [mode === "token" ? "The setup token is incorrect." : "That is not this site's Supabase secret key."] } };
  }

  const admin = createSupabaseAdminClient();
  const { data: required, error: probeError } = await admin.rpc("setup_required");
  if (probeError) {
    log("error", "setup probe failed", { code: probeError.code });
    return { ok: false, error: "Could not reach the database. Check your Supabase configuration." };
  }
  if (!required) redirect("/login");

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { full_name: data.fullName },
  });
  if (createError || !created.user) {
    log("error", "setup create user failed", { status: createError?.status, code: createError?.code });
    return { ok: false, error: createError?.message ?? "Could not create the owner account." };
  }

  const { error: bootstrapError } = await admin.rpc("bootstrap_organization", {
    p_user_id: created.user.id,
    p_org_name: data.businessName,
    p_org_slug: data.businessSlug,
    p_full_name: data.fullName,
  });
  if (bootstrapError) {
    // Roll back the auth user so setup can be retried cleanly.
    await admin.auth.admin.deleteUser(created.user.id);
    log("error", "setup bootstrap failed", { code: bootstrapError.code });
    return {
      ok: false,
      error:
        bootstrapError.code === "55000"
          ? "Setup has already been completed."
          : "Could not create your business. Check that the database migrations have been applied.",
    };
  }

  log("info", "setup completed");
  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password });
  redirect(signInError ? "/login" : "/admin");
}
