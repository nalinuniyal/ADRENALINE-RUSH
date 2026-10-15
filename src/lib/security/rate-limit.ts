import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env.server";
import { hashKey } from "@/lib/security/tokens";

export type RateLimitRule = { namespace: string; limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  loginPerIp: { namespace: "login-ip", limit: 20, windowSeconds: 15 * 60 },
  loginPerEmail: { namespace: "login-email", limit: 8, windowSeconds: 15 * 60 },
  setupPerIp: { namespace: "setup-ip", limit: 5, windowSeconds: 60 * 60 },
  registrationPerIp: { namespace: "register-ip", limit: 12, windowSeconds: 60 * 60 },
  registrationToken: { namespace: "register-token", limit: 1, windowSeconds: 24 * 60 * 60 },
  importPerUser: { namespace: "import-user", limit: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/** Best-effort client IP from the platform's proxy headers (Vercel sets x-forwarded-for). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export type RateResult = "ok" | "limited" | "unavailable";

/**
 * Consumes one hit. "unavailable" means the database could not be reached or
 * setup.sql has not been run; callers fail CLOSED and say so.
 */
export async function checkRateLimit(rule: RateLimitRule, identifier: string): Promise<RateResult> {
  // RATE_LIMIT_SALT is optional: without it the server secret doubles as the
  // salt (it is hashed into the key, never stored), so stored keys still
  // cannot be reversed into IP or email addresses.
  const env = serverEnv();
  const salt = env.RATE_LIMIT_SALT ?? env.SUPABASE_SECRET_KEY;
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("consume_rate_limit", {
      p_key: hashKey(rule.namespace, identifier, salt),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      console.error(JSON.stringify({ level: "error", msg: "rate limit check failed", code: error.code }));
      return "unavailable";
    }
    return data === true ? "ok" : "limited";
  } catch {
    return "unavailable";
  }
}

/** Boolean convenience: true only when allowed. */
export async function consumeRateLimit(rule: RateLimitRule, identifier: string): Promise<boolean> {
  return (await checkRateLimit(rule, identifier)) === "ok";
}

export const DB_UNAVAILABLE_MESSAGE =
  "The database is not reachable or not set up yet. Run supabase/setup.sql in the Supabase SQL Editor and check your .env.local values.";
