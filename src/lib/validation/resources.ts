import { z } from "zod";
import { RESOURCE_TYPES, SHARE_METHODS, TEMPLATE_CHANNELS, VISIBILITIES } from "@/lib/resources/types";

// Form inputs are strings; outputs are DB-ready values.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en-US")} characters`)
    .transform((v) => (v === "" ? null : v));

const HTTPS_RE = /^https:\/\/[^\s<>"]+$/i;

const httpsUrl = z
  .string()
  .trim()
  .min(1, "Paste the link (it must start with https://)")
  .max(1000, "Keep the link under 1,000 characters")
  .refine((v) => HTTPS_RE.test(v) && URL.canParse(v), "Enter a full link that starts with https://");

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(1000, "Keep the link under 1,000 characters")
  .refine((v) => v === "" || (HTTPS_RE.test(v) && URL.canParse(v)), "Enter a full link that starts with https://")
  .transform((v) => (v === "" ? null : v));

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), "Enter a valid date")
  .transform((v) => (v === "" ? null : v));

export const resourceSchema = z.object({
  title: z.string().trim().min(2, "Enter a title (at least 2 characters)").max(160, "Keep the title under 160 characters"),
  type: z.enum(RESOURCE_TYPES, { message: "Choose a type" }),
  url: httpsUrl,
  description: optionalText(4000),
  thumbnailUrl: optionalHttpsUrl,
  visibility: z.enum(VISIBILITIES, { message: "Choose who can see it" }),
  isActive: z.boolean(),
  accessInstructions: optionalText(1000),
  expiresOn: optionalDate,
  courseIds: z.array(z.uuid()).max(20, "Choose at most 20 courses").transform((ids) => [...new Set(ids)]),
});
export type ResourceFormInput = z.input<typeof resourceSchema>;
export type ResourceFormOutput = z.output<typeof resourceSchema>;

export const shareTemplateSchema = z.object({
  name: z.string().trim().min(2, "Enter a name (at least 2 characters)").max(120, "Keep the name under 120 characters"),
  channel: z.enum(TEMPLATE_CHANNELS),
  subject: optionalText(200),
  body: z.string().trim().min(1, "Write the message").max(4000, "Keep the message under 4,000 characters"),
});
export type ShareTemplateInput = z.input<typeof shareTemplateSchema>;

export const sharingSettingsSchema = z.object({
  whatsappCountryCode: z
    .string()
    .trim()
    .transform((v) => v.replace(/^\+/, ""))
    .refine((v) => /^[1-9]\d{0,3}$/.test(v), "Enter a country calling code such as 91 or +91"),
});

export const LINK_MODES = ["page", "direct"] as const;

export const shareSchema = z.object({
  candidateIds: z.array(z.uuid()).max(50, "Share with at most 50 candidates at a time").transform((ids) => [...new Set(ids)]),
  resourceIds: z.array(z.uuid()).min(1, "Choose at least one resource").max(20, "Choose at most 20 resources").transform((ids) => [...new Set(ids)]),
  templateId: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
  courseId: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
  linkMode: z.enum(LINK_MODES),
  subject: z.string().trim().max(200, "Keep the subject under 200 characters"),
  body: z.string().trim().min(1, "Write the message").max(4000, "Keep the message under 4,000 characters"),
  method: z.enum(SHARE_METHODS),
  markDemoShared: z.boolean().default(false),
});
export type ShareInput = z.input<typeof shareSchema>;

export const RESOURCE_STATUS_FILTERS = ["all", "active", "inactive", "shareable", "internal"] as const;

export const resourceListFilterSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  type: z.union([z.enum(RESOURCE_TYPES), z.literal("")]).catch(""),
  course: z.union([z.uuid(), z.literal("")]).catch(""),
  status: z.enum(RESOURCE_STATUS_FILTERS).catch("all"),
});
