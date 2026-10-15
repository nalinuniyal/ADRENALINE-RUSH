import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for integration secrets stored in the database
 * (Google refresh/access tokens). Ciphertext format:
 *   v1.<iv>.<auth tag>.<ciphertext>   (each part base64url)
 * The organization id is bound as associated data, so a token copied into
 * another organization's row does not decrypt.
 *
 * Key: INTEGRATIONS_ENCRYPTION_KEY (64 hex chars, 32-byte base64, or any
 * passphrase of 32+ characters). Without it, a key is derived from
 * SUPABASE_SECRET_KEY, like RATE_LIMIT_SALT. Rotating the key that is in use
 * makes stored tokens unreadable; the app then asks you to reconnect Google.
 */

type Env = Record<string, string | undefined>;

export function integrationKey(env: Env = process.env): Buffer {
  const raw = env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (raw) {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
    if (/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) {
      const b = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      if (b.length === 32) return b;
    }
    if (raw.length < 32) throw new Error("INTEGRATIONS_ENCRYPTION_KEY must be at least 32 characters (generate one with: openssl rand -hex 32)");
    return createHash("sha256").update(`adrenaline-rush:integrations-key:${raw}`).digest();
  }
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Set INTEGRATIONS_ENCRYPTION_KEY or SUPABASE_SECRET_KEY to store integration tokens");
  return createHash("sha256").update(`adrenaline-rush:integrations:v1:${secret}`).digest();
}

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptSecret(plain: string, key: Buffer, associatedData: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ct)}`;
}

/** Throws if the value was tampered with, encrypted with another key, or bound to other data. */
export function decryptSecret(token: string, key: Buffer, associatedData: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unrecognised encrypted value");
  const [, iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** HMAC-SHA256 signature (base64url) with a key derived for a specific purpose. */
export function sign(value: string, key: Buffer, purpose: string): string {
  return createHmac("sha256", key).update(`${purpose}:${value}`).digest("base64url");
}

export function verifySignature(value: string, signature: string, key: Buffer, purpose: string): boolean {
  const expected = Buffer.from(sign(value, key, purpose));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
