// Shared (client-safe) types and helpers for the public website settings.
import type { RegistrationMode } from "@/lib/validation/courses";

export type PublicSocialLinks = {
  linkedin: string | null;
  instagram: string | null;
  youtube: string | null;
  x: string | null;
  facebook: string | null;
};

export type PublicFeaturedCourse = {
  slug: string;
  title: string;
  short_description: string | null;
  cover_image_url: string | null;
  duration_text: string | null;
  delivery_mode: string;
  level: string | null;
  highlight_badge: string | null;
  cta_label: string | null;
  registration_mode: RegistrationMode;
  registration_open: boolean;
};

/** Public-safe website settings (Settings › Website), from get_public_site(). */
export type PublicSite = {
  organization_name: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  hero_badge: string | null;
  about_text: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  whatsapp_number: string | null;
  address: string | null;
  social: PublicSocialLinks;
  footer_tagline: string | null;
  show_course_catalog: boolean;
  featured_course: PublicFeaturedCourse | null;
};

export const EMPTY_PUBLIC_SITE: PublicSite = {
  organization_name: null,
  hero_title: null,
  hero_subtitle: null,
  hero_badge: null,
  about_text: null,
  contact_email: null,
  contact_phone: null,
  whatsapp_number: null,
  address: null,
  social: { linkedin: null, instagram: null, youtube: null, x: null, facebook: null },
  footer_tagline: null,
  show_course_catalog: true,
  featured_course: null,
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const httpsLink = (v: unknown): string | null => {
  const s = text(v);
  return s && /^https:\/\/\S+$/i.test(s) && URL.canParse(s) ? s : null;
};

/** Defensive parse: unknown shapes fall back to empty values, links must be https. */
export function parsePublicSite(data: unknown): PublicSite {
  if (typeof data !== "object" || data === null) return EMPTY_PUBLIC_SITE;
  const d = data as Record<string, unknown>;
  const social = (typeof d.social === "object" && d.social !== null ? d.social : {}) as Record<string, unknown>;
  const fc = typeof d.featured_course === "object" && d.featured_course !== null ? (d.featured_course as Record<string, unknown>) : null;
  return {
    organization_name: text(d.organization_name),
    hero_title: text(d.hero_title),
    hero_subtitle: text(d.hero_subtitle),
    hero_badge: text(d.hero_badge),
    about_text: text(d.about_text),
    contact_email: text(d.contact_email),
    contact_phone: text(d.contact_phone),
    whatsapp_number: text(d.whatsapp_number),
    address: text(d.address),
    social: {
      linkedin: httpsLink(social.linkedin),
      instagram: httpsLink(social.instagram),
      youtube: httpsLink(social.youtube),
      x: httpsLink(social.x),
      facebook: httpsLink(social.facebook),
    },
    footer_tagline: text(d.footer_tagline),
    show_course_catalog: d.show_course_catalog !== false,
    featured_course:
      fc && typeof fc.slug === "string" && typeof fc.title === "string"
        ? {
            slug: fc.slug,
            title: fc.title,
            short_description: text(fc.short_description),
            cover_image_url: httpsLink(fc.cover_image_url),
            duration_text: text(fc.duration_text),
            delivery_mode: typeof fc.delivery_mode === "string" ? fc.delivery_mode : "online",
            level: text(fc.level),
            highlight_badge: text(fc.highlight_badge),
            cta_label: text(fc.cta_label),
            registration_mode: fc.registration_mode === "interest" ? "interest" : "demo",
            registration_open: fc.registration_open === true,
          }
        : null,
  };
}

/** wa.me link for a WhatsApp number ("+91 98765 43210" → https://wa.me/919876543210), or null. */
export function whatsappLink(number: string | null | undefined, message?: string): string | null {
  const digits = (number ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

/** tel: link keeping a leading + and digits only, or null. */
export function telLink(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  const digits = p.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return `tel:${p.startsWith("+") ? "+" : ""}${digits}`;
}

/** Default main button text for a course. */
export function courseCtaLabel(c: { cta_label: string | null; registration_mode: RegistrationMode }): string {
  return c.cta_label ?? (c.registration_mode === "demo" ? "Book a free demo" : "Register now");
}

