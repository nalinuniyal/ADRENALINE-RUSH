import { describe, expect, it } from "vitest";
import { generateInviteToken, hashInviteToken, isWellFormedInviteToken } from "@/lib/team/tokens";

describe("invitation tokens", () => {
  it("are 256-bit base64url strings whose sha256 is stored", () => {
    const { token, hash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("are unique", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInviteToken().token));
    expect(tokens.size).toBe(200);
  });

  it("rejects malformed tokens before any lookup", () => {
    expect(isWellFormedInviteToken(generateInviteToken().token)).toBe(true);
    for (const bad of ["", "short", "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}/`, null, 42]) expect(isWellFormedInviteToken(bad)).toBe(false);
  });
});
