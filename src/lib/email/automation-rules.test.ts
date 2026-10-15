import { describe, expect, it } from "vitest";
import { automationMatches, resolveRecipients } from "./automation-rules";

describe("automationMatches", () => {
  const reg = { course_id: "c1", channel: "demo_request" };
  it("matches all-course and same-course rules for the right channel", () => {
    expect(automationMatches({ course_id: null, channel: "demo_request", is_active: true }, reg)).toBe(true);
    expect(automationMatches({ course_id: "c1", channel: "any", is_active: true }, reg)).toBe(true);
    expect(automationMatches({ course_id: "c2", channel: "demo_request", is_active: true }, reg)).toBe(false);
    expect(automationMatches({ course_id: null, channel: "public_form", is_active: true }, reg)).toBe(false);
    expect(automationMatches({ course_id: null, channel: "any", is_active: false }, reg)).toBe(false);
  });
});

describe("resolveRecipients", () => {
  const ctx = { candidateEmail: " Cand@Example.test ", doNotContact: false, adminRecipients: [] as string[], customEmails: [] as string[], fallbackAdmins: ["owner@example.test"] };
  it("sends to the candidate, normalised", () => {
    expect(resolveRecipients("candidate", ctx)).toEqual([{ to: "cand@example.test", skipReason: null }]);
  });
  it("records honest reasons instead of sending", () => {
    expect(resolveRecipients("candidate", { ...ctx, candidateEmail: null })[0]).toMatchObject({ to: null, skipReason: expect.stringContaining("no valid email") });
    expect(resolveRecipients("candidate", { ...ctx, doNotContact: true })[0].skipReason).toMatch(/do not contact/);
    expect(resolveRecipients("custom", ctx)[0]).toMatchObject({ to: null });
    expect(resolveRecipients("admins", { ...ctx, fallbackAdmins: [] })[0]).toMatchObject({ to: null });
  });
  it("uses team recipients, falling back to owners, deduplicated", () => {
    expect(resolveRecipients("admins", ctx)).toEqual([{ to: "owner@example.test", skipReason: null }]);
    expect(resolveRecipients("admins", { ...ctx, adminRecipients: ["A@x.test", "a@x.test", "bad"] })).toEqual([{ to: "a@x.test", skipReason: null }]);
    expect(resolveRecipients("custom", { ...ctx, customEmails: ["x@y.test"] })).toEqual([{ to: "x@y.test", skipReason: null }]);
  });
});
