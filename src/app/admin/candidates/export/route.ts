import type { NextRequest } from "next/server";
import { getAccess } from "@/lib/auth/session";
import { hasAny } from "@/lib/auth/permissions";
import { toCsv } from "@/lib/csv";
import { candidateListQuery, getLeadStatuses, getMemberNames, type CandidateListRow } from "@/lib/data/candidates";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCandidateFilters } from "@/lib/validation/candidates";

const CHUNK = 1000;
const MAX_ROWS = 20_000;

/** CSV export of the candidate list with the same filters as the list page. RLS applies. */
export async function GET(request: NextRequest) {
  const result = await getAccess();
  if (result.status !== "ok") return new Response("Sign in to export candidates.", { status: 401, headers: { "Cache-Control": "no-store" } });
  const access = result.access;
  if (!hasAny(access.permissions, ["candidates.export"]) || !hasAny(access.permissions, ["candidates.view_all", "candidates.view_assigned"])) {
    return new Response("You do not have permission to export candidates.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = { ...parseCandidateFilters(params), page: 1 };
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const supabase = await createSupabaseServerClient();
  const [statuses, members] = await Promise.all([getLeadStatuses(supabase, orgId), getMemberNames(supabase, orgId)]);
  const statusById = new Map(statuses.map((s) => [s.id, s.label]));

  const rows: CandidateListRow[] = [];
  const now = new Date();
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await candidateListQuery(supabase, orgId, access.userId, filters, now).range(from, from + CHUNK - 1);
    if (error) {
      if (error.code === "PGRST103") break;
      console.error(JSON.stringify({ level: "error", msg: "candidate export failed", code: error.code }));
      return new Response("Could not export candidates. Please try again.", { status: 500, headers: { "Cache-Control": "no-store" } });
    }
    const chunk = (data ?? []) as unknown as CandidateListRow[];
    rows.push(...chunk);
    if (chunk.length < CHUNK) break;
  }

  const headers = [
    "Name", "Email", "Phone", "Company", "Job title", "City", "Country", "Lead status", "Owner", "Latest course",
    "Next follow-up", "Source", "UTM source", "UTM medium", "UTM campaign", "Marketing consent", "Privacy consent at",
    "Do not contact", "Created", "Last activity",
  ];
  const body = toCsv(
    headers,
    rows.map((c) => [
      c.full_name, c.email, c.phone, c.company, c.job_title, c.city, c.country,
      c.lead_status_id ? (statusById.get(c.lead_status_id) ?? "") : "",
      c.owner_id ? (members.get(c.owner_id)?.name ?? "") : "",
      c.latest[0]?.course?.title ?? "",
      c.next[0] ? formatDateTime(c.next[0].due_at, tz) : "",
      c.source, c.utm_source, c.utm_medium, c.utm_campaign,
      c.marketing_consent ? "Yes" : "No",
      c.privacy_consent_at ? formatDateTime(c.privacy_consent_at, tz) : "",
      c.do_not_contact ? "Yes" : "No",
      formatDateTime(c.created_at, tz),
      c.last_activity_at ? formatDateTime(c.last_activity_at, tz) : "",
    ]),
  );

  // Exports contain personal data: record who exported how many (filter names only, never values).
  const { error: auditError } = await supabase.rpc("write_audit_log", {
    p_organization_id: orgId,
    p_action: "candidates.export",
    p_entity_type: "candidates",
    p_details: {
      rows: rows.length,
      truncated: rows.length >= MAX_ROWS,
      filters: Object.entries(filters).filter(([k, v]) => v && k !== "page" && k !== "sort").map(([k]) => k),
    },
  });
  if (auditError) {
    // Fail closed: an export that cannot be audited is not handed out.
    console.error(JSON.stringify({ level: "error", msg: "export audit failed", code: auditError.code }));
    return new Response("Could not export candidates. Please try again.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  return new Response("﻿" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="candidates-${date}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
