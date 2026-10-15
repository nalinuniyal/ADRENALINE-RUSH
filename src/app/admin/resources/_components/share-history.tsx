import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { ShareStatusBadge } from "./resource-badges";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const SHARE_SELECT = "id, candidate_id, resource_ids, resource_titles, method, status, template_name, recipient, error, batch_id, created_at, shared_by, candidates(full_name)";

export type ShareRow = {
  id: string;
  candidate_id: string | null;
  resource_ids: string[];
  resource_titles: string[];
  method: string;
  status: string;
  template_name: string | null;
  recipient: string | null;
  error: string | null;
  created_at: string;
  shared_by: string | null;
  candidateName: string | null;
};

export async function loadShares(
  supabase: Supabase,
  orgId: string,
  opts: { resourceId?: string; candidateId?: string; method?: string; limit: number; offset?: number },
): Promise<{ rows: ShareRow[]; total: number }> {
  let q = supabase.from("resource_shares").select(SHARE_SELECT, { count: "exact" }).eq("organization_id", orgId);
  if (opts.resourceId) q = q.contains("resource_ids", [opts.resourceId]);
  if (opts.candidateId) q = q.eq("candidate_id", opts.candidateId);
  if (opts.method) q = q.eq("method", opts.method);
  const from = opts.offset ?? 0;
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, from + opts.limit - 1);
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "share history load failed", code: error.code }));
    throw new Error("Could not load the share history.");
  }
  const rows = (data ?? []).map((r) => {
    const cand = Array.isArray(r.candidates) ? r.candidates[0] : r.candidates;
    return { ...r, candidateName: cand?.full_name ?? null } as ShareRow;
  });
  return { rows, total: count ?? rows.length };
}

/** Compact list of shares, newest first. */
export function ShareHistoryList({
  rows,
  members,
  timeZone,
  showCandidate = true,
  showResources = true,
  empty = "Nothing shared yet.",
}: {
  rows: ShareRow[];
  members: Map<string, { name: string }>;
  timeZone: string;
  showCandidate?: boolean;
  showResources?: boolean;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((s) => (
        <li key={s.id} className="grid gap-1 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 font-medium break-words">
              {showCandidate ? (
                s.candidate_id ? (
                  <Link href={`/admin/candidates/${s.candidate_id}`} className="text-brand-700 hover:underline">
                    {s.candidateName ?? "Candidate"}
                  </Link>
                ) : (
                  <span className="text-muted">No candidate</span>
                )
              ) : (
                s.resource_titles.join(", ")
              )}
            </span>
            <ShareStatusBadge method={s.method} status={s.status} />
          </div>
          {showCandidate && showResources ? <p className="break-words text-[#444]">{s.resource_titles.join(", ")}</p> : null}
          <p className="text-xs text-muted">
            {formatDateTime(s.created_at, timeZone)}
            {s.shared_by ? ` · by ${members.get(s.shared_by)?.name ?? "Former member"}` : ""}
            {s.template_name ? ` · ${s.template_name}` : ""}
            {s.recipient ? ` · to ${s.method === "whatsapp" ? `+${s.recipient}` : s.recipient}` : ""}
          </p>
          {s.error ? <p className="text-xs text-danger-700">{s.error}</p> : null}
        </li>
      ))}
    </ul>
  );
}
