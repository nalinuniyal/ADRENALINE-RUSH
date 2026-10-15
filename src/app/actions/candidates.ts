"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { zonedToUtc } from "@/lib/format";
import {
  candidateColumns,
  candidateCreateSchema,
  candidateDetailsSchema,
  followUpSchema,
  importCommitSchema,
  importKeysSchema,
  noteSchema,
  ownerChangeSchema,
  statusChangeSchema,
  taskStatusSchema,
} from "@/lib/validation/candidates";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string[] | undefined> };

export type DuplicateMatch = { candidateId: string; matchedOn: "email" | "phone"; canView: boolean; fullName: string | null };

export type CreateCandidateResult = ActionResult & { duplicates?: DuplicateMatch[] };

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const logError = (msg: string, code?: string) => console.error(JSON.stringify({ level: "error", msg, code }));

async function findDuplicates(supabase: Supabase, orgId: string, email: string | null, phone: string | null, exclude?: string) {
  const { data, error } = await supabase.rpc("find_candidate_duplicates", {
    p_org: orgId,
    p_email: email ?? "",
    p_phone: phone ?? "",
    ...(exclude ? { p_exclude: exclude } : {}),
  });
  if (error) {
    logError("duplicate check failed", error.code);
    throw new Error("Could not check for duplicates. Please try again.");
  }
  return (data ?? []).map(
    (d): DuplicateMatch => ({ candidateId: d.candidate_id, matchedOn: d.matched_on === "email" ? "email" : "phone", canView: d.can_view, fullName: d.full_name }),
  );
}

async function isAllowedOwner(supabase: Supabase, orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("list_candidate_owners", { p_org: orgId });
  return (data ?? []).some((o) => o.user_id === userId);
}

const DUPLICATE_MESSAGE = "A candidate with this email or phone number already exists.";

/* -------------------------------------------------------------------------- */
/* Create / edit                                                               */
/* -------------------------------------------------------------------------- */

export async function createCandidate(input: unknown): Promise<CreateCandidateResult> {
  const access = await assertPermission(["candidates.manage"]);
  const parsed = candidateCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors, message: "Please fix the highlighted fields." };
  const v = parsed.data;
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();

  const duplicates = await findDuplicates(supabase, orgId, v.email, v.phone);
  if (duplicates.length) return { ok: false, message: DUPLICATE_MESSAGE, duplicates };

  // Staff limited to assigned candidates always own what they create (RLS requires it too).
  const viewAll = access.permissions.includes("candidates.view_all");
  const ownerId = viewAll ? v.ownerId : access.userId;
  if (ownerId && ownerId !== access.userId && !(await isAllowedOwner(supabase, orgId, ownerId))) {
    return { ok: false, fieldErrors: { ownerId: ["Choose a team member who can manage candidates"] } };
  }

  const { data, error } = await supabase
    .from("candidates")
    .insert({
      organization_id: orgId,
      ...candidateColumns(v),
      source: v.source ?? "manual",
      privacy_consent_at: v.privacyConsent ? new Date().toISOString() : null,
      lead_status_id: v.leadStatusId,
      owner_id: ownerId,
      created_by: access.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    logError("candidate create failed", error?.code);
    return { ok: false, message: error?.code === "23503" ? "The selected status or owner is no longer available." : "Could not create the candidate. Please try again." };
  }

  await supabase.from("candidate_activities").insert({
    organization_id: orgId,
    candidate_id: data.id,
    type: "created",
    summary: "Candidate added manually",
    actor_id: access.userId,
  });

  if (v.courseId) {
    const course = await supabase.from("courses").select("id, title").eq("id", v.courseId).eq("organization_id", orgId).maybeSingle();
    if (course.data) {
      const reg = await supabase
        .from("course_registrations")
        .insert({ organization_id: orgId, candidate_id: data.id, course_id: course.data.id, channel: "manual" })
        .select("id")
        .single();
      if (reg.data) {
        await supabase.from("candidate_activities").insert({
          organization_id: orgId,
          candidate_id: data.id,
          type: "registered",
          summary: `Registered for ${course.data.title} (added by staff)`,
          details: { course_id: course.data.id, registration_id: reg.data.id },
          actor_id: access.userId,
        });
      }
    }
  }

  revalidatePath("/admin/candidates");
  redirect(`/admin/candidates/${data.id}`);
}

export async function updateCandidateDetails(candidateId: string, input: unknown): Promise<CreateCandidateResult> {
  const access = await assertPermission(["candidates.manage"]);
  const parsed = candidateDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors, message: "Please fix the highlighted fields." };
  const v = parsed.data;
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();

  const current = await supabase.from("candidates").select("id, privacy_consent_at").eq("id", candidateId).eq("organization_id", orgId).maybeSingle();
  if (!current.data) return { ok: false, message: "This candidate no longer exists or is not assigned to you." };

  const duplicates = await findDuplicates(supabase, orgId, v.email, v.phone, candidateId);
  if (duplicates.length) return { ok: false, message: DUPLICATE_MESSAGE, duplicates };

  const { data, error } = await supabase
    .from("candidates")
    .update({
      ...candidateColumns(v),
      privacy_consent_at: v.privacyConsent ? (current.data.privacy_consent_at ?? new Date().toISOString()) : null,
    })
    .eq("id", candidateId)
    .eq("organization_id", orgId)
    .select("id");
  if (error) {
    logError("candidate update failed", error.code);
    return { ok: false, message: "Could not save the candidate. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "You do not have permission to change this candidate." };

  revalidatePath(`/admin/candidates/${candidateId}`);
  revalidatePath("/admin/candidates");
  return { ok: true, message: "Details saved." };
}

/* -------------------------------------------------------------------------- */
/* Status, owner                                                               */
/* -------------------------------------------------------------------------- */

export async function setCandidateStatus(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["candidates.manage"]);
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid status." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("candidates")
    .update({ lead_status_id: parsed.data.leadStatusId })
    .eq("id", parsed.data.candidateId)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("candidate status change failed", error.code);
    return { ok: false, message: error.code === "23503" ? "That status is no longer available." : "Could not change the status. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "You do not have permission to change this candidate." };
  revalidatePath(`/admin/candidates/${parsed.data.candidateId}`);
  revalidatePath("/admin/candidates");
  return { ok: true, message: "Status updated." };
}

export async function setCandidateOwner(input: unknown): Promise<ActionResult> {
  // Reassigning moves a record between counselors, so it needs full visibility.
  const access = await assertPermission(["candidates.manage"]);
  if (!access.permissions.includes("candidates.view_all")) return { ok: false, message: "Only team members who see all candidates can reassign them." };
  const parsed = ownerChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a valid owner." };
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;
  if (parsed.data.ownerId && !(await isAllowedOwner(supabase, orgId, parsed.data.ownerId))) {
    return { ok: false, message: "Choose a team member who can manage candidates." };
  }
  const { data, error } = await supabase
    .from("candidates")
    .update({ owner_id: parsed.data.ownerId })
    .eq("id", parsed.data.candidateId)
    .eq("organization_id", orgId)
    .select("id");
  if (error) {
    logError("candidate owner change failed", error.code);
    return { ok: false, message: "Could not change the owner. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "You do not have permission to change this candidate." };
  await supabase.from("candidate_activities").insert({
    organization_id: orgId,
    candidate_id: parsed.data.candidateId,
    type: "owner_changed",
    summary: parsed.data.ownerId ? "Owner changed" : "Owner removed",
    details: { owner_id: parsed.data.ownerId },
    actor_id: access.userId,
  });
  revalidatePath(`/admin/candidates/${parsed.data.candidateId}`);
  revalidatePath("/admin/candidates");
  return { ok: true, message: parsed.data.ownerId ? "Owner updated." : "Candidate is now unassigned." };
}

/* -------------------------------------------------------------------------- */
/* Notes and follow-ups                                                        */
/* -------------------------------------------------------------------------- */

export async function addCandidateNote(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["candidates.manage"]);
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("candidate_notes").insert({
    organization_id: access.organization.id,
    candidate_id: parsed.data.candidateId,
    body: parsed.data.body,
    author_id: access.userId,
  });
  if (error) {
    logError("note add failed", error.code);
    return { ok: false, message: error.code === "42501" ? "You do not have permission to add notes to this candidate." : "Could not save the note. Please try again." };
  }
  revalidatePath(`/admin/candidates/${parsed.data.candidateId}`);
  return { ok: true, message: "Note added." };
}

export async function addFollowUp(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["candidates.manage"]);
  const parsed = followUpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const orgId = access.organization.id;
  const supabase = await createSupabaseServerClient();

  const assignedTo = v.assignedTo ?? access.userId;
  if (assignedTo !== access.userId && !(await isAllowedOwner(supabase, orgId, assignedTo))) {
    return { ok: false, fieldErrors: { assignedTo: ["Choose a team member who can manage candidates"] } };
  }

  let dueAt: string;
  try {
    dueAt = zonedToUtc(v.dueDate, v.dueTime, access.organization.timezone);
  } catch {
    return { ok: false, fieldErrors: { dueDate: ["Choose a valid date"] } };
  }

  const { error } = await supabase.from("follow_up_tasks").insert({
    organization_id: orgId,
    candidate_id: v.candidateId,
    title: v.title,
    notes: v.notes,
    due_at: dueAt,
    assigned_to: assignedTo,
    created_by: access.userId,
  });
  if (error) {
    logError("follow-up add failed", error.code);
    return { ok: false, message: error.code === "42501" ? "You do not have permission to add follow-ups for this candidate." : "Could not schedule the follow-up. Please try again." };
  }
  revalidatePath(`/admin/candidates/${v.candidateId}`);
  revalidatePath("/admin/candidates");
  return { ok: true, message: "Follow-up scheduled." };
}

export async function setFollowUpStatus(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["candidates.manage"]);
  const parsed = taskStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("follow_up_tasks")
    .update({ status: parsed.data.status, completed_at: parsed.data.status === "done" ? new Date().toISOString() : null })
    .eq("id", parsed.data.taskId)
    .eq("organization_id", access.organization.id)
    .select("candidate_id");
  if (error) {
    logError("follow-up update failed", error.code);
    return { ok: false, message: "Could not update the follow-up. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "You do not have permission to change this follow-up." };
  revalidatePath(`/admin/candidates/${data[0].candidate_id}`);
  revalidatePath("/admin/candidates");
  return { ok: true, message: parsed.data.status === "done" ? "Marked as done." : parsed.data.status === "cancelled" ? "Follow-up cancelled." : "Follow-up reopened." };
}

/* -------------------------------------------------------------------------- */
/* CSV import                                                                  */
/* -------------------------------------------------------------------------- */

export type ImportKeysResult = { ok: boolean; message?: string; emails: string[]; phoneKeys: string[] };

/** For the import preview: which normalised emails / phone keys already exist. */
export async function findExistingImportKeys(input: unknown): Promise<ImportKeysResult> {
  const access = await assertPermission(["candidates.import"]);
  const parsed = importKeysSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The file is too large to check.", emails: [], phoneKeys: [] };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("find_existing_candidate_keys", {
    p_org: access.organization.id,
    p_emails: parsed.data.emails,
    p_phone_keys: parsed.data.phoneKeys,
  });
  if (error) {
    logError("import duplicate lookup failed", error.code);
    return { ok: false, message: "Could not check for existing candidates. Duplicates will still be skipped on import.", emails: [], phoneKeys: [] };
  }
  return {
    ok: true,
    emails: (data ?? []).filter((d) => d.kind === "email").map((d) => d.key),
    phoneKeys: (data ?? []).filter((d) => d.kind === "phone").map((d) => d.key),
  };
}

export type ImportRowResult = { row: number; status: "created" | "duplicate" | "invalid"; reason?: string; candidate_id?: string | null };
export type ImportResult = ActionResult & { created?: number; duplicates?: number; invalid?: number; results?: ImportRowResult[] };

export async function importCandidates(input: unknown): Promise<ImportResult> {
  const access = await assertPermission(["candidates.import"]);

  const rate = await checkRateLimit(RATE_LIMITS.importPerUser, access.userId);
  if (rate === "unavailable") return { ok: false, message: "Imports are temporarily unavailable. Please try again shortly." };
  if (rate === "limited") return { ok: false, message: "You have run too many imports in the last hour. Please try again later." };

  const parsed = importCommitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "The import data is not valid." };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;

  if (v.ownerId && !(await isAllowedOwner(supabase, orgId, v.ownerId))) {
    return { ok: false, message: "Choose a team member who can manage candidates as the owner." };
  }

  const { data, error } = await supabase.rpc("import_candidates", {
    p_org: orgId,
    p_rows: v.rows,
    ...(v.ownerId ? { p_owner_id: v.ownerId } : {}),
    ...(v.fileName ? { p_file_name: v.fileName } : {}),
  });
  if (error || !data) {
    logError("candidate import failed", error?.code);
    return { ok: false, message: error?.code === "42501" ? "You do not have permission to import candidates." : "The import failed and nothing was saved. Please try again." };
  }
  const result = data as { created: number; duplicates: number; invalid: number; results: ImportRowResult[] };

  revalidatePath("/admin/candidates");
  return {
    ok: true,
    message: `Imported ${result.created} candidate${result.created === 1 ? "" : "s"}.`,
    created: result.created,
    duplicates: result.duplicates,
    invalid: result.invalid,
    results: result.results,
  };
}
