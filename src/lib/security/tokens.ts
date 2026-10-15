import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (hashing first equalises lengths). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Hash an identifier (IP, email) before using it as a rate-limit key, so raw personal data is never stored. */
export function hashKey(namespace: string, value: string, salt = ""): string {
  const digest = createHash("sha256").update(`${salt}:${namespace}:${value.trim().toLowerCase()}`).digest("hex");
  return `${namespace}:${digest.slice(0, 40)}`;
}
