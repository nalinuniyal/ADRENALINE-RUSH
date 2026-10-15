import { createHash, randomBytes } from "node:crypto";

/**
 * Invitation tokens: 32 random bytes (256 bits) in base64url go into the link;
 * only their sha256 is stored, so a database leak does not reveal usable links.
 */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function generateInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedInviteToken(token: unknown): token is string {
  return typeof token === "string" && INVITE_TOKEN_RE.test(token);
}
