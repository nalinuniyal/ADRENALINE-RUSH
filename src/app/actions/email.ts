"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { deliverAndLog, loadEmailSettings, siteUrl } from "@/lib/email/automations";
import { normalizeAddress } from "@/lib/email/automation-rules";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/email/image";
import { renderEmail } from "@/lib/email/render";
import { sampleVariables, type EmailAudience } from "@/lib/email/variables";
import { checkRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  automationSchema,
  emailSettingsSchema,
  newTemplateSchema,
  templateDesign,
  templateSchema,
} from "@/lib/validation/email";

export type EmailActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  id?: string;
  /** Uploaded image path (/media/<id>). */
  url?: string;
};

type PgError = { code?: string } | null;

const MANAGE = ["marketing.manage"] as const;
const idSchema = z.uuid();
const TEST_EMAIL_LIMIT: RateLimitRule = { namespace: "email-test-user", limit: 20, windowSeconds: 60 * 60 };
const UPLOAD_LIMIT: RateLimitRule = { namespace: "media-upload-user", limit: 60, windowSeconds: 60 * 60 };

function logError(msg: string, error: PgError) {
  // No PII: only the Postgres error code goes to the logs.
  console.error(JSON.stringify({ level: "error", msg, code: error?.code }));
}

const invalid = (): EmailActionResult => ({ ok: false, message: "That item could not be found. Refresh the page and try again." });
const fixFields = (fieldErrors: Record<string, string[] | undefined>): EmailActionResult => ({ ok: false, message: "Please fix the highlighted fields.", fieldErrors });

function revalidateEmails() {
  revalidatePath("/admin/marketing/emails", "layout");
}

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

const STARTER_BODY = `Hi {{first_name}},

Write your message here. Leave a blank line between paragraphs.

Thanks,
{{business_name}}`;

export async function createTemplate(input: unknown): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = newTemplateSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("email_templates")
    .insert({
      organization_id: access.organization.id,
      name: parsed.data.name,
      audience: parsed.data.audience,
      subject: parsed.data.audience === "team" ? "New booking: {{candidate_name}} for {{course_title}}" : "About your {{course_title}} demo class",
      design: {
        heading: parsed.data.audience === "team" ? "New booking" : "Hi {{first_name}}",
        body: parsed.data.audience === "team" ? "{{candidate_name}} booked {{course_title}}.\n\nEmail: {{candidate_email}}\nPhone: {{candidate_phone}}\n\n{{registration_answers}}" : STARTER_BODY,
        button_label: parsed.data.audience === "team" ? "Open candidate" : "View course",
        button_url: parsed.data.audience === "team" ? "{{candidate_admin_url}}" : "{{course_url}}",
        footer_text: "{{business_name}}",
        accent_color: "#0176d3",
      },
      created_by: access.userId,
      updated_by: access.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    logError("email template create failed", error);
    return { ok: false, message: "Could not create the template. Please try again." };
  }
  revalidateEmails();
  return { ok: true, id: data.id, message: "Template created." };
}

export async function updateTemplate(templateId: string, input: unknown): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(templateId).success) return invalid();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const v = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("email_templates")
    .update({
      name: v.name,
      audience: v.audience,
      subject: v.subject,
      preheader: v.preheader,
      design: templateDesign(v),
      custom_html: v.customHtml,
      use_custom_html: v.useCustomHtml,
      updated_by: access.userId,
    })
    .eq("id", templateId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("email template update failed", error);
    return { ok: false, message: error.code === "23514" ? "Some values were not accepted. Check the form and try again." : "Could not save the template. Please try again." };
  }
  if (!data?.length) return invalid();
  revalidateEmails();
  return { ok: true, message: "Template saved. Automations using it send the new version from now on." };
}

export async function duplicateTemplate(templateId: string): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(templateId).success) return invalid();
  const supabase = await createSupabaseServerClient();
  const { data: src, error: readError } = await supabase
    .from("email_templates")
    .select("name, audience, subject, preheader, design, custom_html, use_custom_html")
    .eq("id", templateId)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (readError) {
    logError("email template read failed", readError);
    return { ok: false, message: "Could not copy the template. Please try again." };
  }
  if (!src) return invalid();
  const { data, error } = await supabase
    .from("email_templates")
    .insert({ ...src, name: `${src.name.slice(0, 113)} (copy)`, organization_id: access.organization.id, created_by: access.userId, updated_by: access.userId })
    .select("id")
    .single();
  if (error || !data) {
    logError("email template copy failed", error);
    return { ok: false, message: "Could not copy the template. Please try again." };
  }
  revalidateEmails();
  return { ok: true, id: data.id, message: "Template copied." };
}

export async function deleteTemplate(templateId: string): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(templateId).success) return invalid();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("email_templates").delete().eq("id", templateId).eq("organization_id", access.organization.id).select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, message: "An automation uses this template. Change or delete that automation first." };
    logError("email template delete failed", error);
    return { ok: false, message: "Could not delete the template. Please try again." };
  }
  if (!data?.length) return invalid();
  revalidateEmails();
  return { ok: true, message: "Template deleted." };
}

/**
 * Sends the template as currently edited (not yet saved) to the signed-in
 * user's own address, with example values. Logged as a test.
 */
export async function sendTestEmail(templateId: string | null, input: unknown): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  if (templateId !== null && !idSchema.safeParse(templateId).success) return invalid();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const to = normalizeAddress(access.email);
  if (!to) return { ok: false, message: "Your account has no email address to send a test to." };

  const rate = await checkRateLimit(TEST_EMAIL_LIMIT, access.userId);
  if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many test emails. Try again in an hour." : "Sending is temporarily unavailable. Try again shortly." };

  const v = parsed.data;
  const site = siteUrl();
  const rendered = renderEmail(
    { subject: `[Test] ${v.subject}`, preheader: v.preheader, design: templateDesign(v), custom_html: v.customHtml, use_custom_html: v.useCustomHtml },
    sampleVariables(v.audience as EmailAudience, { business_name: access.organization.name, course_url: `${site}/courses`, demo_url: `${site}/courses` }),
    { siteUrl: site },
  );
  const admin = createSupabaseAdminClient();
  const settings = await loadEmailSettings(admin, access.organization.id);
  const outcome = await deliverAndLog(
    admin,
    { organizationId: access.organization.id, kind: "test", templateId, createdBy: access.userId },
    to,
    rendered,
    { replyTo: normalizeAddress(settings.replyTo), senderName: settings.senderName ?? access.organization.name },
  );
  revalidatePath("/admin/marketing/emails/log");
  if (outcome.status === "sent") return { ok: true, message: `Test email sent to ${to}. Check your inbox (and spam folder).` };
  if (outcome.status === "not_sent") return { ok: false, message: "Not sent: no email provider is configured yet. See Marketing → Emails → Settings." };
  return { ok: false, message: `Sending failed: ${outcome.error ?? "unknown error"}` };
}

// -----------------------------------------------------------------------------
// Images
// -----------------------------------------------------------------------------

/** Uploads an image to media_assets. The type is detected from the bytes, not from the browser. */
export async function uploadImage(formData: FormData): Promise<EmailActionResult> {
  const access = await assertPermission(["marketing.manage", "courses.manage"]);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image to upload." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, message: "Images can be at most 2 MB. Resize or compress it and try again." };

  const rate = await checkRateLimit(UPLOAD_LIMIT, access.userId);
  if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many uploads. Try again in an hour." : "Uploads are temporarily unavailable. Try again shortly." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, message: "Images can be at most 2 MB." };
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { ok: false, message: "Only PNG, JPEG, GIF and WebP images are supported." };

  const buf = Buffer.from(bytes);
  const id = randomUUID();
  const supabase = await createSupabaseServerClient();
  // Insert-only privileges: the row is not read back (the bytes are never exposed to the API).
  const { error } = await supabase.from("media_assets").insert({
    id,
    organization_id: access.organization.id,
    file_name: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || null,
    content_type: sniffed.contentType,
    data: `\\x${buf.toString("hex")}`,
    byte_size: buf.byteLength,
    sha256: createHash("sha256").update(buf).digest("hex"),
    width: sniffed.width,
    height: sniffed.height,
    created_by: access.userId,
  });
  if (error) {
    logError("media upload failed", error);
    return { ok: false, message: "Could not upload the image. Please try again." };
  }
  return { ok: true, id, url: `/media/${id}`, message: "Image uploaded." };
}

// -----------------------------------------------------------------------------
// Automations
// -----------------------------------------------------------------------------

function automationColumns(v: z.output<typeof automationSchema>) {
  return {
    name: v.name,
    course_id: v.courseId,
    channel: v.channel,
    recipient: v.recipient,
    custom_emails: v.recipient === "custom" ? v.customEmails : [],
    template_id: v.templateId,
    is_active: v.isActive,
  };
}

function automationWriteError(error: PgError, msg: string): EmailActionResult {
  if (error?.code === "23503") return { ok: false, message: "The chosen template or course no longer exists. Refresh and try again." };
  logError(msg, error);
  if (error?.code === "23514") return { ok: false, message: "Some values were not accepted. Check the form and try again." };
  return { ok: false, message: "Could not save the automation. Please try again." };
}

export async function createAutomation(input: unknown): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("email_automations")
    .insert({ ...automationColumns(parsed.data), organization_id: access.organization.id, trigger: "registration_created", created_by: access.userId })
    .select("id")
    .single();
  if (error || !data) return automationWriteError(error, "email automation create failed");
  revalidateEmails();
  return { ok: true, id: data.id, message: parsed.data.isActive ? "Automation created and switched on." : "Automation created (switched off)." };
}

export async function updateAutomation(automationId: string, input: unknown): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(automationId).success) return invalid();
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("email_automations")
    .update(automationColumns(parsed.data))
    .eq("id", automationId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) return automationWriteError(error, "email automation update failed");
  if (!data?.length) return invalid();
  revalidateEmails();
  return { ok: true, message: "Automation saved." };
}

export async function setAutomationActive(automationId: string, active: unknown): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(automationId).success || typeof active !== "boolean") return invalid();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("email_automations")
    .update({ is_active: active })
    .eq("id", automationId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) return automationWriteError(error, "email automation toggle failed");
  if (!data?.length) return invalid();
  revalidateEmails();
  return { ok: true, message: active ? "Automation switched on." : "Automation switched off. No emails will be sent by it." };
}

export async function deleteAutomation(automationId: string): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(automationId).success) return invalid();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("email_automations").delete().eq("id", automationId).eq("organization_id", access.organization.id).select("id");
  if (error) {
    logError("email automation delete failed", error);
    return { ok: false, message: "Could not delete the automation. Please try again." };
  }
  if (!data?.length) return invalid();
  revalidateEmails();
  return { ok: true, message: "Automation deleted. Past sends stay in the email log." };
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function updateEmailSettings(input: unknown): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = emailSettingsSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("email_settings")
    .update({ admin_recipients: parsed.data.adminRecipients, reply_to: parsed.data.replyTo, sender_name: parsed.data.senderName })
    .eq("organization_id", access.organization.id)
    .select("organization_id");
  if (error) {
    logError("email settings update failed", error);
    return { ok: false, message: "Could not save the email settings. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "Email settings are missing. Run the latest supabase/setup.sql and try again." };
  revalidateEmails();
  return { ok: true, message: "Email settings saved." };
}

/** Sends a short provider check email to the signed-in user. */
export async function sendProviderTest(): Promise<EmailActionResult> {
  const access = await assertPermission(MANAGE);
  const to = normalizeAddress(access.email);
  if (!to) return { ok: false, message: "Your account has no email address to send a test to." };
  const rate = await checkRateLimit(TEST_EMAIL_LIMIT, access.userId);
  if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many test emails. Try again in an hour." : "Sending is temporarily unavailable. Try again shortly." };

  const site = siteUrl();
  const rendered = renderEmail(
    {
      subject: "[Test] Email is working for {{business_name}}",
      design: {
        heading: "Email is working",
        body: "This test was sent from Marketing → Emails → Settings.\n\nIf you can read this, candidates and your team will receive automatic emails.",
        button_label: "Open email settings",
        button_url: "/admin/marketing/emails/settings",
        footer_text: "{{business_name}}",
      },
    },
    { business_name: access.organization.name },
    { siteUrl: site },
  );
  const admin = createSupabaseAdminClient();
  const settings = await loadEmailSettings(admin, access.organization.id);
  const outcome = await deliverAndLog(admin, { organizationId: access.organization.id, kind: "test", createdBy: access.userId }, to, rendered, {
    replyTo: normalizeAddress(settings.replyTo),
    senderName: settings.senderName ?? access.organization.name,
  });
  revalidatePath("/admin/marketing/emails/log");
  if (outcome.status === "sent") return { ok: true, message: `Test email sent to ${to}. Check your inbox (and spam folder).` };
  if (outcome.status === "not_sent") return { ok: false, message: "Not sent: no email provider is configured. Add the environment variables shown on this page." };
  return { ok: false, message: `Sending failed: ${outcome.error ?? "unknown error"}` };
}
