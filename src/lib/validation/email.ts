import { z } from "zod";
import { AUTOMATION_CHANNELS, AUTOMATION_RECIPIENTS } from "@/lib/email/automation-rules";

/** Same rule as public.email_list_is_valid() in the database. */
export const EMAIL_ADDRESS_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;
export const MAX_RECIPIENTS = 20;

const text = (max: number, label = "This") =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters`)
    .transform((v) => (v === "" ? null : v));

/** Splits "a@x.com, b@y.com\nc@z.com" into lowercased addresses. */
export function splitEmailList(input: string): string[] {
  return input
    .split(/[\s,;]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

const emailList = z
  .string()
  .max(6000)
  .transform((v, ctx) => {
    const list = [...new Set(splitEmailList(v))];
    const bad = list.filter((a) => !EMAIL_ADDRESS_RE.test(a) || a.length > 254);
    if (bad.length) ctx.addIssue({ code: "custom", message: `Not a valid email address: ${bad.slice(0, 3).join(", ")}` });
    if (list.length > MAX_RECIPIENTS) ctx.addIssue({ code: "custom", message: `Use at most ${MAX_RECIPIENTS} addresses` });
    return list;
  });

/** Link fields accept a {{variable}}, an https:// or http:// URL, a site path (/…), or mailto:/tel:. */
const linkLike = (v: string | null) =>
  v === null || /^\{\{\s*[a-z_]+\s*\}\}$/i.test(v) || /^https?:\/\/\S+$/i.test(v) || /^\/(?!\/)\S*$/.test(v) || /^(mailto|tel):\S+$/i.test(v);

export const templateSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name").max(120),
    audience: z.enum(["candidate", "team"]),
    subject: z.string().trim().min(1, "Enter a subject").max(200, "Keep the subject under 200 characters"),
    preheader: text(200, "Preview text"),
    headerImageUrl: text(500, "Image URL").refine((v) => v === null || /^https?:\/\/\S+$/i.test(v) || /^\/media\/[0-9a-f-]{36}$/i.test(v), "Use an uploaded image or a full https:// image URL"),
    headerImageAssetId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || z.uuid().safeParse(v).success, "Invalid image"),
    heading: text(200, "Heading"),
    body: text(10000, "Message"),
    buttonLabel: text(60, "Button label"),
    buttonUrl: text(500, "Button link").refine(linkLike, "Use a {{variable}}, a full https:// link, a site path like /courses, or mailto:"),
    footerText: text(1000, "Footer"),
    accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #0176d3"),
    useCustomHtml: z.boolean(),
    customHtml: text(100000, "Custom HTML"),
  })
  .superRefine((v, ctx) => {
    if (v.useCustomHtml && !v.customHtml) ctx.addIssue({ code: "custom", path: ["customHtml"], message: "Paste your HTML or turn off custom HTML" });
    if (!v.useCustomHtml && !v.body && !v.heading) ctx.addIssue({ code: "custom", path: ["body"], message: "Write a message" });
    if (Boolean(v.buttonLabel) !== Boolean(v.buttonUrl)) {
      ctx.addIssue({ code: "custom", path: [v.buttonLabel ? "buttonUrl" : "buttonLabel"], message: "A button needs both a label and a link" });
    }
  });

export type TemplateFormInput = z.input<typeof templateSchema>;
export type TemplateFormOutput = z.output<typeof templateSchema>;

/** Design jsonb stored in email_templates.design. */
export function templateDesign(v: TemplateFormOutput) {
  return {
    header_image_url: v.headerImageUrl,
    header_image_asset_id: v.headerImageAssetId,
    heading: v.heading,
    body: v.body,
    button_label: v.buttonLabel,
    button_url: v.buttonUrl,
    footer_text: v.footerText,
    accent_color: v.accentColor.toLowerCase(),
  };
}

export const newTemplateSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(120),
  audience: z.enum(["candidate", "team"]),
});

export const automationSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name").max(120),
    courseId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose a course"),
    channel: z.enum(AUTOMATION_CHANNELS),
    recipient: z.enum(AUTOMATION_RECIPIENTS),
    customEmails: emailList,
    templateId: z.uuid("Choose a template"),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.recipient === "custom" && v.customEmails.length === 0) ctx.addIssue({ code: "custom", path: ["customEmails"], message: "Add at least one address" });
  });

export type AutomationFormInput = z.input<typeof automationSchema>;
export type AutomationFormOutput = z.output<typeof automationSchema>;

export const emailSettingsSchema = z.object({
  adminRecipients: emailList,
  replyTo: text(254, "Reply-to").refine((v) => v === null || EMAIL_ADDRESS_RE.test(v), "Enter a valid email address"),
  senderName: text(80, "Sender name"),
});

export type EmailSettingsInput = z.input<typeof emailSettingsSchema>;

export const EMAIL_LOG_STATUSES = ["sent", "failed", "not_sent"] as const;
export const emailLogFilterSchema = z.object({
  status: z.enum([...EMAIL_LOG_STATUSES, "all"]).catch("all"),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});
