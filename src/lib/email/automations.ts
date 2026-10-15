import "server-only";
import { publicEnv } from "@/lib/env";
import { automationMatches, normalizeAddress, resolveRecipients } from "@/lib/email/automation-rules";
import { renderEmail, toDesign, type RenderableTemplate, type RenderedEmail } from "@/lib/email/render";
import { sendEmail, type SendOutcome } from "@/lib/email/send";
import { buildVariables, type EmailAudience } from "@/lib/email/variables";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export function siteUrl(): string {
  return publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

export type TemplateRow = {
  id: string;
  audience: string;
  subject: string;
  preheader: string | null;
  design: unknown;
  custom_html: string | null;
  use_custom_html: boolean;
};

export function toRenderable(t: Omit<TemplateRow, "id" | "audience">): RenderableTemplate {
  return { subject: t.subject, preheader: t.preheader, design: toDesign(t.design), custom_html: t.custom_html, use_custom_html: t.use_custom_html };
}

export type DeliveryLog = {
  organizationId: string;
  kind: "automation" | "test";
  automationId?: string | null;
  templateId?: string | null;
  candidateId?: string | null;
  registrationId?: string | null;
  createdBy?: string | null;
};

/**
 * Sends (unless skipReason is given) and records the attempt in email_log with
 * the privileged client. Callers have already authorised the operation.
 */
export async function deliverAndLog(
  admin: AdminClient,
  log: DeliveryLog,
  to: string | null,
  rendered: RenderedEmail,
  opts: { replyTo?: string | null; senderName?: string | null; skipReason?: string | null; recordActivity?: boolean } = {},
): Promise<SendOutcome> {
  const outcome: SendOutcome =
    !to || opts.skipReason
      ? { status: "not_sent", provider: null, messageId: null, error: opts.skipReason ?? "No recipient address" }
      : await sendEmail({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: opts.replyTo, senderName: opts.senderName });

  const { error } = await admin.from("email_log").insert({
    organization_id: log.organizationId,
    kind: log.kind,
    automation_id: log.automationId ?? null,
    template_id: log.templateId ?? null,
    candidate_id: log.candidateId ?? null,
    registration_id: log.registrationId ?? null,
    created_by: log.createdBy ?? null,
    to_address: to,
    subject: rendered.subject.slice(0, 300),
    status: outcome.status,
    provider: outcome.provider,
    provider_message_id: outcome.messageId,
    error: outcome.error?.slice(0, 1000) ?? null,
  });
  if (error && error.code !== "23505") console.error(JSON.stringify({ level: "error", msg: "email log write failed", code: error.code }));

  if (opts.recordActivity && outcome.status === "sent" && log.candidateId) {
    const { error: actError } = await admin.from("candidate_activities").insert({
      organization_id: log.organizationId,
      candidate_id: log.candidateId,
      type: "email_sent",
      summary: `Email sent: ${rendered.subject}`.slice(0, 240),
      details: { automation_id: log.automationId ?? null, template_id: log.templateId ?? null },
    });
    if (actError) console.error(JSON.stringify({ level: "error", msg: "email activity write failed", code: actError.code }));
  }
  return outcome;
}

/** Owners' addresses: used when no team notification recipients are configured. */
async function ownerEmails(admin: AdminClient, organizationId: string): Promise<string[]> {
  const { data } = await admin
    .from("organization_memberships")
    .select("user_profiles(email)")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .eq("status", "active");
  return (data ?? [])
    .map((m) => (Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles)?.email ?? "")
    .filter(Boolean);
}

export async function loadEmailSettings(admin: AdminClient, organizationId: string) {
  const { data } = await admin.from("email_settings").select("admin_recipients, reply_to, sender_name").eq("organization_id", organizationId).maybeSingle();
  return { adminRecipients: data?.admin_recipients ?? [], replyTo: data?.reply_to ?? null, senderName: data?.sender_name ?? null };
}

export type RunSummary = { matched: number; sent: number; failed: number; notSent: number; skippedDuplicates: number };

/**
 * Runs the "registration_created" automations for one registration: finds the
 * active automations whose course/channel filters match, renders each
 * template for its recipients, sends, and logs every attempt.
 * Never throws (it runs after the visitor's response, from `after()`).
 */
export async function runRegistrationAutomations(registrationId: string): Promise<RunSummary> {
  const summary: RunSummary = { matched: 0, sent: 0, failed: 0, notSent: 0, skippedDuplicates: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { data: reg, error: regError } = await admin
      .from("course_registrations")
      .select("id, organization_id, candidate_id, course_id, channel, answers")
      .eq("id", registrationId)
      .maybeSingle();
    if (regError || !reg) {
      console.error(JSON.stringify({ level: "error", msg: "email automation: registration not found", code: regError?.code }));
      return summary;
    }
    const org = reg.organization_id;

    const { data: automations, error: autoError } = await admin
      .from("email_automations")
      .select("id, course_id, channel, recipient, custom_emails, is_active, template_id, email_templates(id, audience, subject, preheader, design, custom_html, use_custom_html)")
      .eq("organization_id", org)
      .eq("trigger", "registration_created")
      .eq("is_active", true);
    if (autoError) {
      console.error(JSON.stringify({ level: "error", msg: "email automation: load failed", code: autoError.code }));
      return summary;
    }
    const matching = (automations ?? []).filter((a) => automationMatches(a, reg));
    summary.matched = matching.length;
    if (!matching.length) return summary;

    const [candRes, courseRes, orgRes, settings] = await Promise.all([
      admin
        .from("candidates")
        .select(
          "id, full_name, email, phone, do_not_contact, city, country, company, job_title, total_experience_years, relevant_experience_years, skills, interests, learning_objectives, preferred_schedule, preferred_delivery_mode, employment_status, heard_about",
        )
        .eq("id", reg.candidate_id)
        .single(),
      reg.course_id ? admin.from("courses").select("title, slug, demo_url").eq("id", reg.course_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      admin.from("organizations").select("name").eq("id", org).single(),
      loadEmailSettings(admin, org),
    ]);
    if (candRes.error || !candRes.data) {
      console.error(JSON.stringify({ level: "error", msg: "email automation: candidate load failed", code: candRes.error?.code }));
      return summary;
    }
    const candidate = candRes.data;
    const course = courseRes.data;
    const businessName = orgRes.data?.name ?? "";
    const needsOwners = settings.adminRecipients.length === 0 && matching.some((a) => a.recipient === "admins");
    const fallbackAdmins = needsOwners ? await ownerEmails(admin, org) : [];
    const site = siteUrl();

    for (const a of matching) {
      const template = Array.isArray(a.email_templates) ? a.email_templates[0] : a.email_templates;
      if (!template) continue;
      const audience: EmailAudience = a.recipient === "candidate" ? "candidate" : "team";
      const vars = buildVariables({ siteUrl: site, businessName, candidate, course, answers: reg.answers }, audience);
      const rendered = renderEmail(toRenderable(template), vars, { siteUrl: site });
      const recipients = resolveRecipients(a.recipient, {
        candidateEmail: candidate.email,
        doNotContact: candidate.do_not_contact,
        adminRecipients: settings.adminRecipients,
        customEmails: a.custom_emails,
        fallbackAdmins,
      });

      for (const r of recipients) {
        if (r.to && !r.skipReason) {
          const { count } = await admin
            .from("email_log")
            .select("id", { count: "exact", head: true })
            .eq("automation_id", a.id)
            .eq("registration_id", reg.id)
            .eq("to_address", r.to)
            .eq("status", "sent");
          if (count) {
            summary.skippedDuplicates++;
            continue;
          }
        }
        const outcome = await deliverAndLog(
          admin,
          { organizationId: org, kind: "automation", automationId: a.id, templateId: template.id, candidateId: candidate.id, registrationId: reg.id },
          r.to,
          rendered,
          { replyTo: normalizeAddress(settings.replyTo), senderName: settings.senderName ?? businessName, skipReason: r.skipReason, recordActivity: audience === "candidate" },
        );
        if (outcome.status === "sent") summary.sent++;
        else if (outcome.status === "failed") summary.failed++;
        else summary.notSent++;
      }
    }
    console.info(JSON.stringify({ level: "info", msg: "email automations ran", ...summary }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "email automations crashed", error: error instanceof Error ? error.name : "unknown" }));
  }
  return summary;
}
