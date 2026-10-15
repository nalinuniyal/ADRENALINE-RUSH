// Plain JS so both the app (env.ts) and scripts/admin-password.mjs can use it.

/**
 * Turn whatever was pasted as NEXT_PUBLIC_SUPABASE_URL into the bare project URL
 * (https://<ref>.supabase.co). Common mistakes it repairs: a trailing slash, an
 * API path such as /rest/v1 or /auth/v1, surrounding quotes, a missing https://,
 * and the dashboard address (supabase.com/dashboard/project/<ref>).
 *
 * @param {unknown} raw
 * @returns {{ ok: true, url: string, changed: boolean } | { ok: false, reason: string }}
 */
export function normalizeSupabaseUrl(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "it is empty" };
  let s = raw.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
  if (!s) return { ok: false, reason: "it is empty" };

  const dashboard = s.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,40})/i);
  if (dashboard) return { ok: true, url: `https://${dashboard[1].toLowerCase()}.supabase.co`, changed: true };

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    return { ok: false, reason: "it is not a web address" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "it must start with https://" };
  }
  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    return { ok: false, reason: "it is not a full web address (expected https://<project-ref>.supabase.co)" };
  }
  const url = parsed.origin;
  return { ok: true, url, changed: url !== raw.trim() };
}
