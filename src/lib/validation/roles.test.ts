import { describe, expect, it } from "vitest";
import { builtinRoleSchema, customRoleSchema, updateCustomRoleSchema } from "./roles";

describe("customRoleSchema", () => {
  it("trims, sorts and de-duplicates", () => {
    const r = customRoleSchema.parse({ name: "  Accounts ", description: " ", baseRole: "staff", permissions: ["finance.manage", "finance.view", "finance.view"] });
    expect(r).toEqual({ name: "Accounts", description: null, baseRole: "staff", permissions: ["finance.view", "finance.manage"] });
  });

  it("rejects the owner base, unknown permissions, built-in names and broken combinations", () => {
    expect(customRoleSchema.safeParse({ name: "Boss", baseRole: "owner", permissions: [] }).success).toBe(false);
    expect(customRoleSchema.safeParse({ name: "Odd", baseRole: "staff", permissions: ["finance.everything"] }).success).toBe(false);
    expect(customRoleSchema.safeParse({ name: "Instructor", baseRole: "staff", permissions: [] }).success).toBe(false);
    expect(customRoleSchema.safeParse({ name: "X", baseRole: "staff", permissions: [] }).success).toBe(false);
    const broken = customRoleSchema.safeParse({ name: "Payments", baseRole: "staff", permissions: ["finance.manage"] });
    expect(broken.success).toBe(false);
  });

  it("an update keeps the base role out of reach", () => {
    const r = updateCustomRoleSchema.parse({ id: "0b4f5c3e-1a2b-4c3d-8e9f-0123456789ab", name: "Accounts", baseRole: "admin", permissions: [] });
    expect(r).not.toHaveProperty("baseRole");
  });

  it("built-in edits never target the owner", () => {
    expect(builtinRoleSchema.safeParse({ role: "owner", permissions: [] }).success).toBe(false);
    expect(builtinRoleSchema.safeParse({ role: "staff", permissions: ["dashboard.view"] }).success).toBe(true);
  });
});
