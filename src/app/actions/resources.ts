"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { normalizeAddress } from "@/lib/email/automation-rules";
import { deliverAndLog, loadEmailSettings, siteUrl } from "@/lib/email/automations";
import { renderEmail } from "@/lib/email/render";
import { whatsappChatLink } from "@/lib/public-site";
import { buildShareVariables, linksForCopy, renderShareMessage, resourceSlug, type ShareResource } from "@/lib/resources/message";
import { isShareable, todayIn, type ShareMethod, type ShareStatus } from "@/lib/resources/types";
import { checkRateLimit, type RateLimitRule } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchConditions } from "@/lib/validation/candidates";
import { resourceSchema, shareSchema, shareTemplateSchema, sharingSettingsSchema } from "@/lib/validation/resources";

export type ResourceActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  id?: string;
};

export type ShareOutcome = { candidateId: string | null; name: string | null; status: ShareStatus | "skipped"; error?: string };
export type ShareActionResult = ResourceActionResult & { outcomes?: ShareOutcome[] };

type PgError = { code?: string } | null;
type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const MANAGE = ["resources.manage"] as const;
const idSchema = z.uuid();
const SHARE_EMAIL_LIMIT: RateLimitRule = { namespace: "share-email-user", limit: 100, windowSeconds: 60 * 60 };

function logError(msg: string, error: PgError) {
  // No PII: only the Postgres error code goes to the logs.
  console.error(JSON.stringify({ level: "error", msg, code: error?.code }));
}

const invalid = (): ResourceActionResult => ({ ok: false, message: "That item could not be found. Refresh the page and try again." });
const fixFields = (fieldErrors: Record<string, string[] | undefined>): ResourceActionResult => ({ ok: false, message: "Please fix the highlighted fields.", fieldErrors });

function revalidateResources() {
  revalidatePath("/admin/resources", "layout");
}

// -----------------------------------------------------------------------------
// Resources
// -----------------------------------------------------------------------------

function resourceColumns(v: z.output<typeof resourceSchema>) {
  return {
    title: v.title,
    type: v.type,
    url: v.url,
    description: v.description,
    thumbnail_url: v.thumbnailUrl,
    visibility: v.visibility,
    is_active: v.isActive,
    access_instructions: v.accessInstructions,
    expires_on: v.expiresOn,
  };
}

/** Replaces a resource's course links. Courses outside the organization are rejected by the database. */
async function setResourceCourses(supabase: Supabase, resourceId: string, courseIds: string[]): Promise<boolean> {
  const { error: delError } = await supabase.from("resource_courses").delete().eq("resource_id", resourceId);
  if (delError) {
    logError("resource courses clear failed", delError);
    return false;
  }
  if (!courseIds.length) return true;
  const { error } = await supabase.from("resource_courses").insert(courseIds.map((course_id) => ({ resource_id: resourceId, course_id })));
  if (error) {
    logError("resource courses insert failed", error);
    return false;
  }
  return true;
}

export async function createResource(input: unknown): Promise<ResourceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();

  let created: { id: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const { data, error } = await supabase
      .from("resources")
      .insert({
        ...resourceColumns(v),
        organization_id: access.organization.id,
        slug: resourceSlug(v.title, randomBytes(6).toString("base64url")),
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select("id")
      .single();
    if (error?.code === "23505") continue; // slug collision: try another suffix
    if (error || !data) {
      logError("resource create failed", error);
      return { ok: false, message: error?.code === "23514" ? "Some values were not accepted. Check the form and try again." : "Could not save the resource. Please try again." };
    }
    created = data;
  }
  if (!created) return { ok: false, message: "Could not save the resource. Please try again." };

  const coursesOk = await setResourceCourses(supabase, created.id, v.courseIds);
  revalidateResources();
  return {
    ok: true,
    id: created.id,
    message: coursesOk ? "Resource saved." : "Resource saved, but its courses could not be linked. Open it and choose the courses again.",
  };
}

export async function updateResource(resourceId: string, input: unknown): Promise<ResourceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(resourceId).success) return invalid();
  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("resources")
    .update({ ...resourceColumns(parsed.data), updated_by: access.userId })
    .eq("id", resourceId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("resource update failed", error);
    return { ok: false, message: error.code === "23514" ? "Some values were not accepted. Check the form and try again." : "Could not save the resource. Please try again." };
  }
  if (!data?.length) return invalid();
  const coursesOk = await setResourceCourses(supabase, resourceId, parsed.data.courseIds);
  revalidateResources();
  return { ok: coursesOk, message: coursesOk ? "Resource saved." : "Details saved, but the courses could not be updated. Please try again." };
}

export async function setResourceActive(resourceId: string, active: unknown): Promise<ResourceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(resourceId).success || typeof active !== "boolean") return invalid();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("resources")
    .update({ is_active: active, updated_by: access.userId })
    .eq("id", resourceId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("resource toggle failed", error);
    return { ok: false, message: "Could not change the resource. Please try again." };
  }
  if (!data?.length) return invalid();
  revalidateResources();
  return { ok: true, message: active ? "Resource switched on." : "Resource switched off. Its public page stops working and it can no longer be shared." };
}

export async function deleteResource(resourceId: string): Promise<ResourceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(resourceId).success) return invalid();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("resources").delete().eq("id", resourceId).eq("organization_id", access.organization.id).select("id, title");
  if (error) {
    logError("resource delete failed", error);
    return { ok: false, message: "Could not delete the resource. Please try again." };
  }
  if (!data?.length) return invalid();
  const { error: auditError } = await supabase.rpc("write_audit_log", {
    p_organization_id: access.organization.id,
    p_action: "resource.deleted",
    p_entity_type: "resource",
    p_entity_id: resourceId,
    p_details: { title: data[0].title },
  });
  if (auditError) logError("resource delete audit failed", auditError);
  revalidateResources();
  return { ok: true, message: "Resource deleted. Its public link no longer works; share history keeps its title." };
}

// -----------------------------------------------------------------------------
// Message templates
// -----------------------------------------------------------------------------

export async function createShareTemplate(input: unknown): Promise<ResourceActionResult> {
  const access = await assertPermission(MANAGE);
  const parsed = shareTemplateSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("share_templates")
    .insert({ ...parsed.data, organization_id: access.organization.id, position: 100, created_by: access.userId, updated_by: access.userId })
    .select("id")
    .single();
  if (error || !data) {
    logError("share template create failed", error);
    return { ok: false, message: "Could not create the template. Please try again." };
  }
  revalidateResources();
  return { ok: true, id: data.id, message: "Template created." };
}

export async function updateShareTemplate(templateId: string, input: unknown): Promise<ResourceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(templateId).success) return invalid();
  const parsed = shareTemplateSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("share_templates")
    .update({ ...parsed.data, updated_by: access.userId })
    .eq("id", templateId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("share template update failed", error);
    return { ok: false, message: "Could not save the template. Please try again." };
  }
  if (!data?.length) return invalid();
  revalidateResources();
  return { ok: true, message: "Template saved." };
}

export async function deleteShareTemplate(templateId: string): Promise<ResourceActionResult> {
  const access = await assertPermission(MANAGE);
  if (!idSchema.safeParse(templateId).success) return invalid();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("share_templates").delete().eq("id", templateId).eq("organization_id", access.organization.id).select("id");
  if (error) {
    logError("share template delete failed", error);
    return { ok: false, message: "Could not delete the template. Please try again." };
  }
  if (!data?.length) return invalid();
  revalidateResources();
  return { ok: true, message: "Template deleted. Share history keeps its name." };
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export async function updateSharingSettings(input: unknown): Promise<ResourceActionResult> {
  const access = await assertPermission(["settings.manage", "integrations.manage"]);
  const parsed = sharingSettingsSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sharing_settings")
    .update({ whatsapp_country_code: parsed.data.whatsappCountryCode, updated_by: access.userId })
    .eq("organization_id", access.organization.id)
    .select("organization_id");
  if (error) {
    logError("sharing settings update failed", error);
    return { ok: false, message: "Could not save the setting. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "Sharing settings are missing. Run the latest supabase/setup.sql and try again." };
  revalidatePath("/admin/settings");
  revalidateResources();
  return { ok: true, message: `Saved. Numbers without a country code will use +${parsed.data.whatsappCountryCode}.` };
}

// -----------------------------------------------------------------------------
// Sharing
// -----------------------------------------------------------------------------

const STATUS_FOR: Record<Exclude<ShareMethod, "email">, ShareStatus> = { copy_message: "copied", copy_link: "copied", whatsapp: "opened" };

/**
 * Records a share and, for email, sends it. Copying and opening WhatsApp
 * happen in the browser; they are recorded as "copied"/"opened", never as
 * sent. Emails are "sent" only when the provider accepted them.
 */
export async function shareResources(input: unknown): Promise<ShareActionResult> {
  const access = await assertPermission(["resources.share"]);
  const parsed = shareSchema.safeParse(input);
  if (!parsed.success) return fixFields(parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const orgId = access.organization.id;
  if ((v.method === "whatsapp" || v.method === "email") && v.candidateIds.length === 0) {
    return { ok: false, message: "Choose at least one candidate to share with by WhatsApp or email." };
  }

  const supabase = await createSupabaseServerClient();
  const [resourcesRes, templateRes, courseRes, candidatesRes, settingsRes, profileRes] = await Promise.all([
    supabase.from("resources").select("id, title, slug, url, visibility, is_active, expires_on").eq("organization_id", orgId).in("id", v.resourceIds),
    v.templateId ? supabase.from("share_templates").select("id").eq("organization_id", orgId).eq("id", v.templateId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    v.courseId ? supabase.from("courses").select("title, slug, status").eq("organization_id", orgId).eq("id", v.courseId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    v.candidateIds.length
      ? supabase.from("candidates").select("id, full_name, email, phone, do_not_contact, lead_status_id").eq("organization_id", orgId).in("id", v.candidateIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("sharing_settings").select("whatsapp_country_code").eq("organization_id", orgId).maybeSingle(),
    supabase.from("user_profiles").select("full_name").eq("id", access.userId).maybeSingle(),
  ]);
  if (resourcesRes.error || candidatesRes.error) {
    logError("share load failed", resourcesRes.error ?? candidatesRes.error);
    return { ok: false, message: "Could not load the share details. Please try again." };
  }

  const day = todayIn(access.organization.timezone);
  const byId = new Map((resourcesRes.data ?? []).map((r) => [r.id, r]));
  const resources: ShareResource[] = [];
  for (const id of v.resourceIds) {
    const r = byId.get(id);
    if (!r || !isShareable(r, day)) return { ok: false, message: "One of the chosen resources is internal, switched off, expired or deleted. Refresh and choose again." };
    resources.push({ id: r.id, title: r.title, slug: r.slug, url: r.url });
  }
  const candidates = candidatesRes.data ?? [];
  if (candidates.length !== v.candidateIds.length) return { ok: false, message: "One of the chosen candidates no longer exists or is not visible to you." };
  const templateId = templateRes.data?.id ?? null;
  const course = courseRes.data ? { title: courseRes.data.title, slug: courseRes.data.slug, published: courseRes.data.status === "published" } : null;
  const countryCode = settingsRes.data?.whatsapp_country_code ?? "91";
  const site = siteUrl();
  const senderName = profileRes.data?.full_name?.trim() || access.organization.name;

  const base = { siteUrl: site, businessName: access.organization.name, senderName, course, resources, linkMode: v.linkMode };
  const linksOnly = linksForCopy(resources, site, v.linkMode);
  const messageFor = (candidate: { full_name: string } | null) =>
    v.method === "copy_link" ? linksOnly : renderShareMessage(v.body, buildShareVariables({ ...base, candidate }));

  const batchId = v.candidateIds.length > 1 ? randomUUID() : null;
  const outcomes: ShareOutcome[] = [];
  const rows: {
    candidate_id: string | null;
    status: ShareStatus;
    recipient: string | null;
    message: string;
    error: string | null;
  }[] = [];

  if (v.method === "email") {
    const rate = await checkRateLimit(SHARE_EMAIL_LIMIT, access.userId);
    if (rate !== "ok") return { ok: false, message: rate === "limited" ? "Too many emails in the last hour. Try again later." : "Sending is temporarily unavailable. Try again shortly." };
  }
  const admin = v.method === "email" ? createSupabaseAdminClient() : null;
  const emailSettings = admin ? await loadEmailSettings(admin, orgId) : null;

  const targets: ({ id: string; full_name: string; email: string | null; phone: string | null; do_not_contact: boolean } | null)[] = candidates.length ? candidates : [null];
  for (const c of targets) {
    if (c?.do_not_contact) {
      outcomes.push({ candidateId: c.id, name: c.full_name, status: "skipped", error: "Marked do not contact." });
      continue;
    }
    const message = messageFor(c);
    if (v.method === "whatsapp") {
      const link = whatsappChatLink(c?.phone, message, countryCode);
      if (!link.ok) {
        outcomes.push({ candidateId: c?.id ?? null, name: c?.full_name ?? null, status: "skipped", error: link.reason });
        continue;
      }
      rows.push({ candidate_id: c?.id ?? null, status: "opened", recipient: link.digits, message, error: null });
    } else if (v.method === "email" && admin && c) {
      const to = normalizeAddress(c.email);
      if (!to) {
        outcomes.push({ candidateId: c.id, name: c.full_name, status: "skipped", error: "No valid email address saved." });
        continue;
      }
      const vars = buildShareVariables({ ...base, candidate: c });
      const subject = renderShareMessage(v.subject || "Resources from {{business_name}}", vars).replace(/\s+/g, " ");
      const rendered = renderEmail(
        {
          subject,
          design: {
            body: message,
            button_label: course?.published ? "View course details" : null,
            button_url: course?.published ? vars.course_url : null,
            footer_text: `Sent by ${senderName} at ${access.organization.name}. Reply to this email if you have any questions.`,
          },
        },
        { business_name: access.organization.name },
        { siteUrl: site },
      );
      const outcome = await deliverAndLog(admin, { organizationId: orgId, kind: "share", candidateId: c.id, createdBy: access.userId }, to, rendered, {
        replyTo: normalizeAddress(emailSettings?.replyTo) ?? normalizeAddress(access.email),
        senderName: emailSettings?.senderName ?? access.organization.name,
      });
      rows.push({ candidate_id: c.id, status: outcome.status, recipient: to, message, error: outcome.error });
    } else {
      rows.push({ candidate_id: c?.id ?? null, status: STATUS_FOR[v.method as Exclude<ShareMethod, "email">], recipient: null, message, error: null });
    }
  }

  if (rows.length) {
    const { error } = await supabase.from("resource_shares").insert(
      rows.map((r) => ({
        organization_id: orgId,
        candidate_id: r.candidate_id,
        resource_ids: resources.map((x) => x.id),
        method: v.method,
        status: r.status,
        template_id: templateId,
        recipient: r.recipient,
        message: r.message.slice(0, 6000),
        error: r.error?.slice(0, 1000) ?? null,
        batch_id: batchId,
        shared_by: access.userId,
      })),
    );
    if (error) {
      logError("share record failed", error);
      const emailed = rows.filter((r) => r.status === "sent").length;
      return {
        ok: false,
        message:
          v.method === "email" && emailed
            ? `${emailed} email${emailed === 1 ? " was" : "s were"} sent, but the share could not be recorded in the history.`
            : error.code === "42501"
              ? "You do not have permission to share with this candidate."
              : "Could not record the share. Please try again.",
      };
    }
    const nameOf = new Map(candidates.map((c) => [c.id, c.full_name]));
    for (const r of rows) outcomes.push({ candidateId: r.candidate_id, name: r.candidate_id ? (nameOf.get(r.candidate_id) ?? null) : null, status: r.status, error: r.error ?? undefined });
  }

  if (v.markDemoShared && rows.length && access.permissions.includes("candidates.manage")) {
    // Failed or unsent emails do not count as shared.
    const shared = rows.filter((r) => r.status !== "failed" && r.status !== "not_sent").map((r) => r.candidate_id);
    await markDemoShared(supabase, orgId, shared.filter((id): id is string => Boolean(id)), candidates);
  }

  revalidateResources();
  for (const c of candidates) revalidatePath(`/admin/candidates/${c.id}`);
  return { ok: rows.length > 0, outcomes, message: summarize(v.method, outcomes) };
}

/** Moves candidates in an earlier, open stage to "Demo Shared". */
async function markDemoShared(supabase: Supabase, orgId: string, ids: string[], candidates: { id: string; lead_status_id: string | null }[]) {
  if (!ids.length) return;
  const { data: statuses } = await supabase.from("lead_statuses").select("id, key, position, is_closed").eq("organization_id", orgId);
  const target = statuses?.find((s) => s.key === "demo_shared");
  if (!target) return;
  const earlier = new Set((statuses ?? []).filter((s) => !s.is_closed && s.position < target.position).map((s) => s.id));
  const move = candidates.filter((c) => ids.includes(c.id) && (c.lead_status_id === null || earlier.has(c.lead_status_id))).map((c) => c.id);
  if (!move.length) return;
  const { error } = await supabase.from("candidates").update({ lead_status_id: target.id }).eq("organization_id", orgId).in("id", move);
  if (error) logError("mark demo shared failed", error);
}

function summarize(method: ShareMethod, outcomes: ShareOutcome[]): string {
  const count = (s: ShareOutcome["status"]) => outcomes.filter((o) => o.status === s).length;
  const skipped = count("skipped");
  const skippedText = skipped ? ` ${skipped} skipped (see below).` : "";
  if (method === "email") {
    const parts = [`${count("sent")} sent`, count("failed") ? `${count("failed")} failed` : "", count("not_sent") ? `${count("not_sent")} not sent (no email provider configured)` : ""].filter(Boolean);
    return `Email: ${parts.join(", ")}.${skippedText}`;
  }
  const recorded = outcomes.length - skipped;
  if (method === "whatsapp") return recorded ? `WhatsApp opened and recorded. Press send in WhatsApp to deliver it.${skippedText}` : `Not opened.${skippedText}`;
  return recorded ? `Copied and recorded in the share history.${skippedText}` : `Nothing was recorded.${skippedText}`;
}

// -----------------------------------------------------------------------------
// Candidate search for the share screen
// -----------------------------------------------------------------------------

export type ShareCandidate = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  do_not_contact: boolean;
  marketing_consent: boolean;
};

/** Up to 20 candidates matching name, email or phone (only ones the user may see). */
export async function searchShareCandidates(q: unknown): Promise<ShareCandidate[]> {
  const access = await assertPermission(["resources.share"]);
  if (typeof q !== "string") return [];
  const conds = searchConditions(q.slice(0, 100));
  if (!conds.length) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("candidates")
    .select("id, full_name, email, phone, do_not_contact, marketing_consent")
    .eq("organization_id", access.organization.id)
    .eq("is_archived", false)
    .or(conds.join(","))
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (error) {
    logError("share candidate search failed", error);
    return [];
  }
  return data ?? [];
}
