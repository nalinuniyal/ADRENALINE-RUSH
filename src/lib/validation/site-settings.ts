import { z } from "zod";

// Form inputs are strings; outputs are DB-ready values (empty → null).

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en-US")} characters`)
    .transform((v) => (v === "" ? null : v));

const PHONE_RE = /^\+?[0-9 ()-]{6,32}$/;

const optionalPhone = (message: string, digits?: { min: number; max: number }) =>
  z
    .string()
    .trim()
    .refine((v) => {
      if (v === "") return true;
      if (!PHONE_RE.test(v)) return false;
      const n = v.replace(/\D/g, "").length;
      return !digits || (n >= digits.min && n <= digits.max);
    }, message)
    .transform((v) => (v === "" ? null : v));

/** Social profile links must be https (same rule as the site_settings CHECK constraints). */
const socialUrl = z
  .string()
  .trim()
  .max(500, "Keep the link under 500 characters")
  .refine((v) => v === "" || (/^https:\/\/\S+$/i.test(v) && URL.canParse(v)), "Use a full link starting with https://")
  .transform((v) => (v === "" ? null : v));

export const siteSettingsSchema = z.object({
  heroTitle: optionalText(140),
  heroSubtitle: optionalText(400),
  heroBadge: optionalText(80),
  featuredCourseId: z
    .string()
    .trim()
    .refine((v) => v === "" || z.uuid().safeParse(v).success, "Choose a course")
    .transform((v) => (v === "" ? null : v)),
  aboutText: optionalText(4000),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Keep the email under 254 characters")
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
    .transform((v) => (v === "" ? null : v)),
  contactPhone: optionalPhone("Enter a phone number with country code, e.g. +91 98765 43210"),
  whatsappNumber: optionalPhone("Enter the WhatsApp number with country code, e.g. +91 98765 43210", { min: 8, max: 15 }),
  address: optionalText(500),
  linkedinUrl: socialUrl,
  instagramUrl: socialUrl,
  youtubeUrl: socialUrl,
  xUrl: socialUrl,
  facebookUrl: socialUrl,
  footerTagline: optionalText(300),
  showCourseCatalog: z.boolean(),
});

export type SiteSettingsInput = z.input<typeof siteSettingsSchema>;
export type SiteSettingsOutput = z.output<typeof siteSettingsSchema>;

export const EMPTY_SITE_SETTINGS_FORM: SiteSettingsInput = {
  heroTitle: "",
  heroSubtitle: "",
  heroBadge: "",
  featuredCourseId: "",
  aboutText: "",
  contactEmail: "",
  contactPhone: "",
  whatsappNumber: "",
  address: "",
  linkedinUrl: "",
  instagramUrl: "",
  youtubeUrl: "",
  xUrl: "",
  facebookUrl: "",
  footerTagline: "",
  showCourseCatalog: true,
};
