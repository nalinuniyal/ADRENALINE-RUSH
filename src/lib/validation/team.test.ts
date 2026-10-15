import { describe, expect, it } from "vitest";
import { acceptInviteSchema, inviteSchema, permissionOverrideSchema, roleChangeSchema } from "@/lib/validation/team";

const token = "A".repeat(43);

describe("inviteSchema", () => {
  it("normalises the email and empty phone", () => {
    const r = inviteSchema.parse({ fullName: "  Rahul Kumar ", email: " Rahul@Example.TEST ", role: "staff", phone: "" });
    expect(r).toEqual({ fullName: "Rahul Kumar", email: "rahul@example.test", role: "staff", phone: null, sendEmail: true });
  });
  it("never allows inviting an owner", () => {
    expect(inviteSchema.safeParse({ fullName: "Some One", email: "a@example.test", role: "owner" }).success).toBe(false);
  });
  it("checks email and phone format", () => {
    const r = inviteSchema.safeParse({ fullName: "Some One", email: "not-an-email", role: "staff", phone: "call me" });
    expect(r.success).toBe(false);
    const fe = r.error!.flatten().fieldErrors;
    expect(fe.email).toBeTruthy();
    expect(fe.phone).toBeTruthy();
  });
});

describe("acceptInviteSchema", () => {
  it("requires a strong, confirmed password for a new login", () => {
    expect(acceptInviteSchema.safeParse({ token, fullName: "Rahul", password: "weakpassword", confirmPassword: "weakpassword" }).success).toBe(false);
    expect(acceptInviteSchema.safeParse({ token, fullName: "Rahul", password: "Strong-Pass-123", confirmPassword: "Strong-Pass-124" }).success).toBe(false);
    expect(acceptInviteSchema.safeParse({ token, fullName: "Rahul", password: "Strong-Pass-123", confirmPassword: "Strong-Pass-123" }).success).toBe(true);
  });
  it("only needs the current password for an existing login", () => {
    expect(acceptInviteSchema.safeParse({ token, mode: "existing", fullName: "Rahul", password: "old" }).success).toBe(true);
    expect(acceptInviteSchema.safeParse({ token, mode: "existing", fullName: "Rahul", password: "" }).success).toBe(false);
  });
  it("rejects malformed tokens", () => {
    const r = acceptInviteSchema.safeParse({ token: "../../etc", fullName: "Rahul", password: "Strong-Pass-123", confirmPassword: "Strong-Pass-123" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.token).toBeTruthy();
  });
});

describe("member changes", () => {
  it("accepts only known roles and permission keys", () => {
    const id = "6f1c1f3e-8f4e-4c55-9a59-6f3a0c9a8b11";
    expect(roleChangeSchema.safeParse({ id, role: "admin" }).success).toBe(true);
    expect(roleChangeSchema.safeParse({ id, role: "superuser" }).success).toBe(false);
    expect(permissionOverrideSchema.safeParse({ membershipId: id, permission: "finance.view", value: "allow" }).success).toBe(true);
    expect(permissionOverrideSchema.safeParse({ membershipId: id, permission: "root.all", value: "allow" }).success).toBe(false);
  });
});
