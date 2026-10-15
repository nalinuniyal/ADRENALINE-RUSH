import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  effectiveInviteStatus,
  inviteExpiry,
  inviteProblemMessage,
  inviteShareText,
  inviteUrl,
  isLastActiveOwner,
  memberLockReason,
  roleSwitchedOn,
  whatsappShareLink,
  type MemberLike,
} from "@/lib/team/rules";

const owner: MemberLike = { id: "m1", userId: "u1", role: "owner", status: "active" };
const admin: MemberLike = { id: "m2", userId: "u2", role: "admin", status: "active" };
const staff: MemberLike = { id: "m3", userId: "u3", role: "staff", status: "active" };

describe("assignableRoles", () => {
  it("only the owner hands out admin (and owner, for existing members)", () => {
    expect(assignableRoles("owner")).toEqual(["admin", "staff", "instructor"]);
    expect(assignableRoles("owner", true)).toEqual(["owner", "admin", "staff", "instructor"]);
    expect(assignableRoles("admin")).toEqual(["staff", "instructor"]);
    expect(assignableRoles("admin", true)).toEqual(["staff", "instructor"]);
    expect(assignableRoles("staff")).not.toContain("admin");
  });
});

describe("memberLockReason", () => {
  it("nobody changes themselves", () => {
    expect(memberLockReason({ userId: "u1", role: "owner" }, owner)).toMatch(/your own/);
  });
  it("admins cannot change owners or other admins, but can change staff", () => {
    expect(memberLockReason({ userId: "u2", role: "admin" }, owner)).toMatch(/Only the owner/);
    expect(memberLockReason({ userId: "u9", role: "admin" }, admin)).toMatch(/Only the owner/);
    expect(memberLockReason({ userId: "u2", role: "admin" }, staff)).toBeNull();
  });
  it("the owner can change admins", () => {
    expect(memberLockReason({ userId: "u1", role: "owner" }, admin)).toBeNull();
  });
});

describe("isLastActiveOwner", () => {
  it("protects the only active owner", () => {
    expect(isLastActiveOwner([owner, admin, staff], owner)).toBe(true);
    expect(isLastActiveOwner([owner, admin], admin)).toBe(false);
  });
  it("another active owner lifts the protection; a suspended one does not", () => {
    const second = { id: "m4", userId: "u4", role: "owner" as const, status: "active" as const };
    expect(isLastActiveOwner([owner, second], owner)).toBe(false);
    expect(isLastActiveOwner([owner, { ...second, status: "suspended" }], owner)).toBe(true);
  });
});

describe("invitation status and expiry", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  it("pending invitations past their expiry show as expired", () => {
    expect(effectiveInviteStatus("pending", "2026-10-15T09:59:59Z", now)).toBe("expired");
    expect(effectiveInviteStatus("pending", "2026-10-16T00:00:00Z", now)).toBe("pending");
    expect(effectiveInviteStatus("revoked", "2026-10-01T00:00:00Z", now)).toBe("revoked");
  });
  it("expires 7 days later", () => {
    expect(inviteExpiry(now).toISOString()).toBe("2026-10-22T10:00:00.000Z");
  });
  it("every problem code has a message; success codes do not", () => {
    for (const code of ["used", "accepted", "revoked", "expired", "email_mismatch", "not_found", "anything-else"]) expect(inviteProblemMessage(code)).toBeTruthy();
    for (const code of ["ok", "pending", "already_member"]) expect(inviteProblemMessage(code)).toBeNull();
  });
});

describe("roleSwitchedOn", () => {
  it("follows the Business profile switches for staff and instructors only", () => {
    const sw = { staffEnabled: false, instructorsEnabled: true };
    expect(roleSwitchedOn("staff", sw)).toBe(false);
    expect(roleSwitchedOn("instructor", sw)).toBe(true);
    expect(roleSwitchedOn("admin", { staffEnabled: false, instructorsEnabled: false })).toBe(true);
  });
});

describe("links and sharing", () => {
  const token = "A".repeat(43);
  it("builds the invite URL without double slashes", () => {
    expect(inviteUrl("https://example.com/", token)).toBe(`https://example.com/invite/${token}`);
  });
  it("prefills WhatsApp to the person's number when valid, otherwise a share link", () => {
    const text = inviteShareText({ inviteeName: "Rahul Kumar", businessName: "Example Academy", role: "staff", url: "https://example.com/invite/x" });
    expect(text).toContain("Hi Rahul");
    expect(text).toContain("Staff / Counselor");
    expect(text).toContain("https://example.com/invite/x");
    expect(whatsappShareLink(text, "+91 98765 43210")).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(text)}`);
    expect(whatsappShareLink(text, null)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
    expect(whatsappShareLink(text, "12")).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
  });
});
