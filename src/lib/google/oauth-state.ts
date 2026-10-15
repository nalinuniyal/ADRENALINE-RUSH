import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { safeEqual } from "@/lib/security/tokens";
import { sign, verifySignature } from "./crypto";

/**
 * CSRF protection for the Google OAuth round trip. Starting the flow puts a
 * random `state` and a PKCE code verifier in a signed, HttpOnly cookie bound to
 * the signed-in user and organization. The callback only accepts a code when
 * the `state` query parameter matches that cookie AND the same user is signed in.
 */

export const STATE_COOKIE = "ar_google_oauth";
export const STATE_TTL_SECONDS = 10 * 60;
const PURPOSE = "google-oauth-state";

export type OAuthState = { state: string; verifier: string; userId: string; orgId: string; exp: number };

export function newOAuthState(userId: string, orgId: string, now = Date.now()): OAuthState {
  return {
    state: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    userId,
    orgId,
    exp: Math.floor(now / 1000) + STATE_TTL_SECONDS,
  };
}

/** PKCE S256 challenge for a verifier. */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function sealState(s: OAuthState, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${sign(body, key, PURPOSE)}`;
}

export type StateCheck =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "missing" | "tampered" | "expired" | "mismatch" | "wrong_user" };

export function checkState(
  cookieValue: string | undefined,
  queryState: string | null,
  current: { userId: string; orgId: string },
  key: Buffer,
  now = Date.now(),
): StateCheck {
  if (!cookieValue || !queryState) return { ok: false, reason: "missing" };
  const [body, sig] = cookieValue.split(".");
  if (!body || !sig || !verifySignature(body, sig, key, PURPOSE)) return { ok: false, reason: "tampered" };
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "tampered" };
  }
  if (typeof parsed.exp !== "number" || parsed.exp * 1000 < now) return { ok: false, reason: "expired" };
  if (typeof parsed.state !== "string" || !safeEqual(parsed.state, queryState)) return { ok: false, reason: "mismatch" };
  if (parsed.userId !== current.userId || parsed.orgId !== current.orgId) return { ok: false, reason: "wrong_user" };
  return { ok: true, state: parsed };
}
