import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

/**
 * Pay-link tokens. The token in /pay/<token> is HMAC-SHA256(secret, id.nonce)
 * in base64url (43 characters, 256 bits). The database stores only the nonce
 * and sha256(token): a copy of the database cannot be turned into working
 * links, while the server can re-create the link to copy or send it again.
 * Changing the secret invalidates every pay link (make new ones).
 */
export const PAY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newPayLinkSeed(): { id: string; nonce: string } {
  return { id: randomUUID(), nonce: randomBytes(18).toString("base64url") };
}

export function payLinkToken(secret: string, id: string, nonce: string): string {
  if (secret.length < 16) throw new Error("Pay link secret is too short");
  return createHmac("sha256", secret).update(`pay-link:${id}.${nonce}`, "utf8").digest("base64url");
}

export function hashPayToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedPayToken(token: unknown): token is string {
  return typeof token === "string" && PAY_TOKEN_RE.test(token);
}

export const payLinkUrl = (siteUrl: string, token: string) => `${siteUrl.replace(/\/+$/, "")}/pay/${token}`;
