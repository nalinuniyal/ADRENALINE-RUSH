"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { leadStatusKey, leadStatusSchema, leadStatusUpdateSchema, uniqueKey } from "@/lib/validation/candidates";
import type { ActionResult } from "./candidates";

const logError = (msg: string, code?: string) => console.error(JSON.stringify({ level: "error", msg, code }));

function revalidate() {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/candidates", "layout");
}

export async function createLeadStatus(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["settings.manage"]);
  const parsed = leadStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;

  const existing = await supabase.from("lead_statuses").select("key, label, position").eq("organization_id", orgId);
  if (existing.error) return { ok: false, message: "Could not load lead statuses. Please try again." };
  const rows = existing.data ?? [];
  if (rows.some((r) => r.label.trim().toLowerCase() === v.label.toLowerCase())) {
    return { ok: false, fieldErrors: { label: ["A status with this label already exists"] } };
  }

  const { error } = await supabase.from("lead_statuses").insert({
    organization_id: orgId,
    key: uniqueKey(leadStatusKey(v.label), rows.map((r) => r.key)),
    label: v.label,
    color: v.color,
    is_closed: v.isClosed,
    is_won: v.isWon,
    position: Math.max(0, ...rows.map((r) => r.position)) + 10,
  });
  if (error) {
    logError("lead status create failed", error.code);
    return { ok: false, message: "Could not add the status. Please try again." };
  }
  revalidate();
  return { ok: true, message: `Added “${v.label}”.` };
}

export async function updateLeadStatus(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["settings.manage"]);
  const parsed = leadStatusUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_statuses")
    .update({ label: v.label, color: v.color, is_closed: v.isClosed, is_won: v.isWon })
    .eq("id", v.id)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    logError("lead status update failed", error.code);
    return { ok: false, message: "Could not save the status. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "You do not have permission to change lead statuses." };
  revalidate();
  return { ok: true, message: "Status saved." };
}

const moveSchema = z.object({ id: z.guid(), direction: z.enum(["up", "down"]) });

export async function moveLeadStatus(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["settings.manage"]);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const orgId = access.organization.id;

  const { data, error } = await supabase.from("lead_statuses").select("id, position").eq("organization_id", orgId).order("position").order("created_at");
  if (error || !data) return { ok: false, message: "Could not load lead statuses. Please try again." };

  const ids = data.map((s) => s.id);
  const i = ids.indexOf(parsed.data.id);
  const j = parsed.data.direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];

  // Renumber everything so positions stay unique and evenly spaced.
  const updates = ids
    .map((id, idx) => ({ id, position: (idx + 1) * 10 }))
    .filter((u) => data.find((s) => s.id === u.id)?.position !== u.position);
  const results = await Promise.all(
    updates.map((u) => supabase.from("lead_statuses").update({ position: u.position }).eq("id", u.id).eq("organization_id", orgId)),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    logError("lead status reorder failed", failed.error.code);
    return { ok: false, message: "Could not reorder. Please try again." };
  }
  revalidate();
  return { ok: true };
}

export async function deleteLeadStatus(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["settings.manage"]);
  const parsed = z.object({ id: z.guid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("lead_statuses")
    .delete()
    .eq("id", parsed.data.id)
    .eq("organization_id", access.organization.id)
    .select("id");
  if (error) {
    // The database refuses to delete statuses that candidates still use.
    if (error.code === "23503") return { ok: false, message: "This status is used by candidates. Move them to another status first." };
    if (error.code === "23514") return { ok: false, message: "The default “New” status cannot be deleted." };
    logError("lead status delete failed", error.code);
    return { ok: false, message: "Could not delete the status. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "You do not have permission to delete lead statuses." };
  revalidate();
  return { ok: true, message: "Status deleted." };
}
