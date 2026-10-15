import { describe, expect, it } from "vitest";
import { isProtectedPath, safeNextPath } from "./routes";

describe("isProtectedPath", () => {
  it.each(["/admin", "/admin/", "/admin/settings", "/admin/candidates/123"])("protects %s", (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });
  it.each(["/", "/login", "/setup", "/courses/x", "/administrator", "/api/health"])("leaves %s public", (p) => {
    expect(isProtectedPath(p)).toBe(false);
  });
});

describe("safeNextPath (open-redirect protection)", () => {
  it("keeps internal admin paths with their query", () => {
    expect(safeNextPath("/admin/settings")).toBe("/admin/settings");
    expect(safeNextPath("/admin/candidates?status=new")).toBe("/admin/candidates?status=new");
  });
  it.each([
    "https://evil.example/admin",
    "//evil.example/admin",
    "/\\evil.example",
    "javascript:alert(1)",
    "/login",
    "/",
    "/admin\r\nSet-Cookie: x=1",
    "",
    undefined,
    null,
  ])("falls back for %s", (input) => {
    expect(safeNextPath(input as string | undefined)).toBe("/admin");
  });
});
