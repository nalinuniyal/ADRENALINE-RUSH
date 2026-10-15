import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { DEFAULT_INVITATION_TEMPLATE, invitationVariables } = await import("@/lib/team/invite-email");
const { renderEmail } = await import("@/lib/email/render");
const { unknownVariables } = await import("@/lib/email/variables");

describe("team invitation email", () => {
  const vars = invitationVariables({
    organizationId: "org",
    businessName: "Example Academy",
    timezone: "Asia/Kolkata",
    inviterName: "Asha",
    inviteeName: "Rahul Kumar",
    email: "rahul@example.test",
    role: "instructor",
    url: "https://example.com/invite/abc",
    expiresAt: new Date("2026-10-22T10:00:00Z"),
  });

  it("fills every variable the default template uses", () => {
    const t = DEFAULT_INVITATION_TEMPLATE;
    expect(unknownVariables(t.subject, t.preheader, t.design.heading, t.design.body, t.design.button_url, t.design.footer_text)).toEqual([]);
    expect(vars).toMatchObject({ invitee_name: "Rahul", invite_role: "Instructor", inviter_name: "Asha", invite_url: "https://example.com/invite/abc" });
    expect(vars.invite_expires).toMatch(/22/);
  });

  it("renders a button to the invite link and the business name in the subject", () => {
    const out = renderEmail(DEFAULT_INVITATION_TEMPLATE, vars, { siteUrl: "https://example.com" });
    expect(out.subject).toBe("Asha invited you to join Example Academy");
    expect(out.html).toContain('href="https://example.com/invite/abc"');
    expect(out.text).toContain("https://example.com/invite/abc");
    expect(out.text).toContain("as Instructor");
  });
});
