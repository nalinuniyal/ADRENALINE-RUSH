import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decryptSecret, encryptSecret, integrationKey } from "./crypto";
import { checkState, codeChallenge, newOAuthState, sealState } from "./oauth-state";

const key = integrationKey({ INTEGRATIONS_ENCRYPTION_KEY: "a".repeat(64) });
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("integration secret encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const sealed = encryptSecret("1//refresh-token", key, ORG);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("refresh-token");
    expect(decryptSecret(sealed, key, ORG)).toBe("1//refresh-token");
    expect(encryptSecret("same", key, ORG)).not.toBe(encryptSecret("same", key, ORG));
  });

  it("fails on tampering, another key or another organization", () => {
    const sealed = encryptSecret("token", key, ORG);
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, ORG)).toThrow();
    expect(() => decryptSecret(sealed, integrationKey({ SUPABASE_SECRET_KEY: "sb_secret_other_value_for_tests" }), ORG)).toThrow();
    expect(() => decryptSecret(sealed, key, "33333333-3333-4333-8333-333333333333")).toThrow();
    expect(() => decryptSecret("plain", key, ORG)).toThrow(/Unrecognised/);
  });

  it("accepts hex, base64 or passphrase keys and falls back to the Supabase secret", () => {
    expect(integrationKey({ INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") })).toEqual(Buffer.alloc(32, 7));
    expect(integrationKey({ INTEGRATIONS_ENCRYPTION_KEY: "a long passphrase that is over 32 chars" })).toHaveLength(32);
    expect(() => integrationKey({ INTEGRATIONS_ENCRYPTION_KEY: "short" })).toThrow(/32 characters/);
    expect(integrationKey({ SUPABASE_SECRET_KEY: "sb_secret_x" })).toHaveLength(32);
    expect(() => integrationKey({})).toThrow();
  });
});

describe("OAuth state cookie", () => {
  const current = { userId: USER, orgId: ORG };

  it("accepts the matching state for the same signed-in user", () => {
    const s = newOAuthState(USER, ORG, 0);
    const res = checkState(sealState(s, key), s.state, current, key, 1000);
    expect(res).toEqual({ ok: true, state: s });
    expect(codeChallenge("verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects missing, forged, expired, mismatched or other-user states", () => {
    const s = newOAuthState(USER, ORG, 0);
    const sealed = sealState(s, key);
    expect(checkState(undefined, s.state, current, key, 0)).toMatchObject({ reason: "missing" });
    expect(checkState(sealed, null, current, key, 0)).toMatchObject({ reason: "missing" });
    const forged = sealState({ ...s, userId: "attacker" }, integrationKey({ INTEGRATIONS_ENCRYPTION_KEY: "b".repeat(64) }));
    expect(checkState(forged, s.state, current, key, 0)).toMatchObject({ reason: "tampered" });
    expect(checkState(sealed, s.state, current, key, 11 * 60 * 1000)).toMatchObject({ reason: "expired" });
    expect(checkState(sealed, "other-state", current, key, 0)).toMatchObject({ reason: "mismatch" });
    expect(checkState(sealed, s.state, { userId: "someone-else", orgId: ORG }, key, 0)).toMatchObject({ reason: "wrong_user" });
  });
});
