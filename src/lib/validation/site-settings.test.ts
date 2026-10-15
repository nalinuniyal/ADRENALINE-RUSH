import { describe, expect, it } from "vitest";
import { EMPTY_SITE_SETTINGS_FORM, siteSettingsSchema } from "./site-settings";

const errorsOf = (r: { error?: { issues: { path: PropertyKey[] }[] } }) => (r.error?.issues ?? []).map((i) => i.path.join("."));

describe("siteSettingsSchema", () => {
  it("turns an empty form into nulls and keeps the catalogue switch", () => {
    const r = siteSettingsSchema.safeParse(EMPTY_SITE_SETTINGS_FORM);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ heroTitle: null, featuredCourseId: null, contactEmail: null, whatsappNumber: null, linkedinUrl: null, showCourseCatalog: true });
  });

  it("trims and normalises valid values", () => {
    const r = siteSettingsSchema.safeParse({
      ...EMPTY_SITE_SETTINGS_FORM,
      heroTitle: "  Learn MCP  ",
      featuredCourseId: "6f1d2c3b-4a5e-4f60-8a7b-1c2d3e4f5a6b",
      contactEmail: " Hello@Example.COM ",
      contactPhone: "+91 98765 43210",
      whatsappNumber: "+91 98765-43210",
      linkedinUrl: "https://www.linkedin.com/company/example",
      showCourseCatalog: false,
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ heroTitle: "Learn MCP", contactEmail: "hello@example.com", whatsappNumber: "+91 98765-43210", showCourseCatalog: false });
  });

  it("rejects insecure or malformed links, bad emails, bad numbers and long text", () => {
    const r = siteSettingsSchema.safeParse({
      ...EMPTY_SITE_SETTINGS_FORM,
      linkedinUrl: "http://linkedin.com/x",
      instagramUrl: "javascript:alert(1)",
      youtubeUrl: "https://",
      contactEmail: "not-an-email",
      contactPhone: "call me",
      whatsappNumber: "12345",
      featuredCourseId: "abc",
      heroTitle: "x".repeat(141),
      heroBadge: "x".repeat(81),
    });
    expect(errorsOf(r)).toEqual(
      expect.arrayContaining(["linkedinUrl", "instagramUrl", "youtubeUrl", "contactEmail", "contactPhone", "whatsappNumber", "featuredCourseId", "heroTitle", "heroBadge"]),
    );
  });
});
