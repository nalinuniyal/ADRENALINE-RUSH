import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { combinedOrFilter, isLeadStatusColor, PAGE_SIZE, searchConditions, sourceConditions, type CandidateFilters, type LeadStatusColor } from "@/lib/validation/candidates";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type LeadStatus = {
  id: string;
  key: string;
  label: string;
  color: LeadStatusColor;
  position: number;
  is_closed: boolean;
  is_won: boolean;
};

export async function getLeadStatuses(supabase: Supabase, orgId: string): Promise<LeadStatus[]> {
  const { data, error } = await supabase
    .from("lead_statuses")
    .select("id, key, label, color, position, is_closed, is_won")
    .eq("organization_id", orgId)
    .order("position")
    .order("created_at");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "lead statuses load failed", code: error.code }));
    throw new Error("Could not load lead statuses.");
  }
  return (data ?? []).map((s) => ({ ...s, color: isLeadStatusColor(s.color) ? s.color : "neutral" }));
}

export type OwnerOption = { user_id: string; full_name: string | null; email: string; role: string };

/** Active members who may own candidates (hold candidates.manage). */
export async function getCandidateOwners(supabase: Supabase, orgId: string): Promise<OwnerOption[]> {
  const { data, error } = await supabase.rpc("list_candidate_owners", { p_org: orgId });
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "candidate owners load failed", code: error.code }));
    return [];
  }
  return data ?? [];
}

export type MemberName = { name: string; email: string };

/** user id -> display name for every member of the organization (for owner/author labels). */
export async function getMemberNames(supabase: Supabase, orgId: string): Promise<Map<string, MemberName>> {
  const { data } = await supabase
    .from("organization_memberships")
    .select("user_id, user_profiles(full_name, email)")
    .eq("organization_id", orgId);
  const map = new Map<string, MemberName>();
  for (const m of data ?? []) {
    const p = Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles;
    if (p) map.set(m.user_id, { name: p.full_name || p.email, email: p.email });
  }
  return map;
}

export type CourseOption = { id: string; title: string; slug: string; status: string };

/** Courses the user can see (needs courses.view; empty otherwise). */
export async function getCourseOptions(supabase: Supabase, orgId: string): Promise<CourseOption[]> {
  const { data } = await supabase
    .from("courses")
    .select("id, title, slug, status")
    .eq("organization_id", orgId)
    .neq("status", "archived")
    .order("title");
  return data ?? [];
}

export type CandidateListRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  job_title: string | null;
  city: string | null;
  country: string | null;
  owner_id: string | null;
  lead_status_id: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  marketing_consent: boolean;
  privacy_consent_at: string | null;
  do_not_contact: boolean;
  created_at: string;
  last_activity_at: string | null;
  latest: { created_at: string; course: { title: string; slug: string } | null }[];
  next: { due_at: string; title: string }[];
};

const LIST_COLUMNS =
  "id, full_name, email, phone, company, job_title, city, country, owner_id, lead_status_id, source, utm_source, utm_medium, utm_campaign, marketing_consent, privacy_consent_at, do_not_contact, created_at, last_activity_at, latest:course_registrations(created_at, course:courses(title, slug)), next:follow_up_tasks(due_at, title)";

/**
 * The candidate list query shared by the list page and the CSV export. Runs as
 * the signed-in user, so RLS limits staff to their assigned candidates.
 */
export function candidateListQuery(supabase: Supabase, orgId: string, userId: string, filters: CandidateFilters, now = new Date()) {
  let select = LIST_COLUMNS;
  if (filters.course) select += ", reg:course_registrations!inner(course_id)";
  if (filters.followup === "overdue") select += ", overdue:follow_up_tasks!inner(id)";

  let q = supabase
    .from("candidates")
    .select(select, { count: "exact" })
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .order("created_at", { referencedTable: "latest", ascending: false })
    .limit(1, { referencedTable: "latest" })
    .eq("next.status", "open")
    .order("due_at", { referencedTable: "next", ascending: true })
    .limit(1, { referencedTable: "next" });

  if (filters.status) q = q.eq("lead_status_id", filters.status);
  if (filters.course) q = q.eq("reg.course_id", filters.course);
  if (filters.owner === "unassigned") q = q.is("owner_id", null);
  else if (filters.owner === "me") q = q.eq("owner_id", userId);
  else if (filters.owner) q = q.eq("owner_id", filters.owner);
  if (filters.followup === "overdue") q = q.eq("overdue.status", "open").lt("overdue.due_at", now.toISOString());

  const or = combinedOrFilter([filters.q ? searchConditions(filters.q) : [], filters.source ? sourceConditions(filters.source) : []]);
  if (or) q = q.or(or);

  switch (filters.sort) {
    case "oldest":
      q = q.order("created_at", { ascending: true });
      break;
    case "name":
      q = q.order("full_name", { ascending: true });
      break;
    case "activity":
      q = q.order("last_activity_at", { ascending: false, nullsFirst: false });
      break;
    default:
      q = q.order("created_at", { ascending: false });
  }
  return q.order("id");
}

export async function listCandidates(
  supabase: Supabase,
  orgId: string,
  userId: string,
  filters: CandidateFilters,
): Promise<{ rows: CandidateListRow[]; total: number; outOfRange: boolean }> {
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await candidateListQuery(supabase, orgId, userId, filters).range(from, from + PAGE_SIZE - 1);
  if (error) {
    // Asking for a page past the end is not an error worth failing the page for.
    if (error.code === "PGRST103") return { rows: [], total: count ?? 0, outOfRange: true };
    console.error(JSON.stringify({ level: "error", msg: "candidate list failed", code: error.code }));
    throw new Error("Could not load candidates.");
  }
  return { rows: (data ?? []) as unknown as CandidateListRow[], total: count ?? 0, outOfRange: false };
}
