import { describe, expect, it } from "vitest";
import { courseCtaLabel, EMPTY_PUBLIC_SITE, parsePublicSite, telLink, whatsappLink } from "./public-site";

describe("public site helpers", () => {
  it("builds wa.me and tel links only from plausible numbers", () => {
    expect(whatsappLink("+91 98765 43210")).toBe("https://wa.me/919876543210");
    expect(whatsappLink("+91 98765 43210", "Hi there")).toBe("https://wa.me/919876543210?text=Hi%20there");
    expect(whatsappLink("123")).toBeNull();
    expect(whatsappLink(null)).toBeNull();
    expect(telLink("+91 (98765) 43210")).toBe("tel:+919876543210");
    expect(telLink("")).toBeNull();
  });

  it("uses the course label or the default for its registration mode", () => {
    expect(courseCtaLabel({ cta_label: null, registration_mode: "demo" })).toBe("Book a free demo");
    expect(courseCtaLabel({ cta_label: null, registration_mode: "interest" })).toBe("Register now");
    expect(courseCtaLabel({ cta_label: "Join the MCP demo", registration_mode: "demo" })).toBe("Join the MCP demo");
  });

  it("parses the RPC payload defensively", () => {
    expect(parsePublicSite(null)).toEqual(EMPTY_PUBLIC_SITE);
    const site = parsePublicSite({
      organization_name: "Adrenaline Rush",
      hero_title: "  ",
      contact_email: "hello@example.com",
      show_course_catalog: false,
      social: { linkedin: "https://linkedin.com/company/x", instagram: "http://insecure.example", youtube: "javascript:alert(1)" },
      featured_course: { slug: "mcp", title: "MCP", registration_mode: "weird", registration_open: true, cover_image_url: "http://x" },
    });
    expect(site.hero_title).toBeNull();
    expect(site.contact_email).toBe("hello@example.com");
    expect(site.show_course_catalog).toBe(false);
    expect(site.social).toEqual({ linkedin: "https://linkedin.com/company/x", instagram: null, youtube: null, x: null, facebook: null });
    expect(site.featured_course).toMatchObject({ slug: "mcp", registration_mode: "demo", registration_open: true, cover_image_url: null });
  });
});
