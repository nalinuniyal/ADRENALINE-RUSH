import { describe, expect, it } from "vitest";
import { automationSchema, emailSettingsSchema, templateSchema, type TemplateFormInput } from "./email";

const tpl: TemplateFormInput = {
  name: "Confirmation",
  audience: "candidate",
  subject: "Hi {{first_name}}",
  preheader: "",
  headerImageUrl: "/media/3f1c1c1c-1111-4111-8111-111111111111",
  headerImageAssetId: "3f1c1c1c-1111-4111-8111-111111111111",
  heading: "",
  body: "Hello",
  buttonLabel: "Open",
  buttonUrl: "{{course_url}}",
  footerText: "",
  accentColor: "#0176D3",
  useCustomHtml: false,
  customHtml: "",
};

describe("templateSchema", () => {
  it("accepts a valid template and turns empty strings into null", () => {
    const out = templateSchema.parse(tpl);
    expect(out.preheader).toBeNull();
    expect(out.customHtml).toBeNull();
  });
  it("rejects unsafe or incomplete values", () => {
    const bad = (patch: Partial<TemplateFormInput>) => templateSchema.safeParse({ ...tpl, ...patch }).success;
    expect(bad({ buttonUrl: "javascript:alert(1)" })).toBe(false);
    expect(bad({ headerImageUrl: "/etc/passwd" })).toBe(false);
    expect(bad({ accentColor: "red" })).toBe(false);
    expect(bad({ buttonUrl: "" })).toBe(false);
    expect(bad({ useCustomHtml: true, customHtml: "" })).toBe(false);
    expect(bad({ body: "", heading: "" })).toBe(false);
  });
});

describe("automationSchema", () => {
  const base = { name: "Notify", courseId: "", channel: "demo_request", recipient: "custom", customEmails: "A@x.test, b@y.test\nA@x.test", templateId: "3f1c1c1c-1111-4111-8111-111111111111", isActive: true } as const;
  it("splits and dedupes custom addresses", () => {
    const out = automationSchema.parse(base);
    expect(out.customEmails).toEqual(["a@x.test", "b@y.test"]);
    expect(out.courseId).toBeNull();
  });
  it("requires addresses for custom recipients and rejects invalid ones", () => {
    expect(automationSchema.safeParse({ ...base, customEmails: "" }).success).toBe(false);
    expect(automationSchema.safeParse({ ...base, customEmails: "not-an-email" }).success).toBe(false);
    expect(automationSchema.safeParse({ ...base, recipient: "candidate", customEmails: "" }).success).toBe(true);
  });
});

describe("emailSettingsSchema", () => {
  it("validates recipients and reply-to", () => {
    expect(emailSettingsSchema.parse({ adminRecipients: "a@x.test\n\nb@x.test", replyTo: "", senderName: "" })).toEqual({ adminRecipients: ["a@x.test", "b@x.test"], replyTo: null, senderName: null });
    expect(emailSettingsSchema.safeParse({ adminRecipients: Array.from({ length: 21 }, (_, i) => `a${i}@x.test`).join("\n"), replyTo: "", senderName: "" }).success).toBe(false);
    expect(emailSettingsSchema.safeParse({ adminRecipients: "", replyTo: "nope", senderName: "" }).success).toBe(false);
  });
});
