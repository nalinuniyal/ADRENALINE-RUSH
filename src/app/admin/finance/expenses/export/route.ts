import type { NextRequest } from "next/server";
import { hasAny } from "@/lib/auth/permissions";
import { getAccess } from "@/lib/auth/session";
import { getMemberNames } from "@/lib/data/candidates";
import { expensesQuery } from "@/lib/data/finance";
import { expensesCsv, type ExpenseExportRow } from "@/lib/finance/export";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseFinanceFilters } from "@/lib/validation/finance";

const CHUNK = 1000;
const MAX_ROWS = 20_000;
const noStore = { "Cache-Control": "no-store" };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** CSV of expenses with the same filters as the list. Needs finance.view AND reports.export; RLS applies. */
export async function GET(request: NextRequest) {
  const result = await getAccess();
  if (result.status !== "ok") return new Response("Sign in to export expenses.", { status: 401, headers: noStore });
  const access = result.access;
  if (!hasAny(access.permissions, ["finance.view"]) || !hasAny(access.permissions, ["reports.export"])) {
    return new Response("You do not have permission to export expenses.", { status: 403, headers: noStore });
  }
  const filters = parseFinanceFilters(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const supabase = await createSupabaseServerClient();
  const members = await getMemberNames(supabase, orgId);

  const rows: ExpenseExportRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await expensesQuery(supabase, orgId, filters).range(from, from + CHUNK - 1);
    if (error) {
      if (error.code === "PGRST103") break;
      console.error(JSON.stringify({ level: "error", msg: "expense export failed", code: error.code }));
      return new Response("Could not export expenses. Please try again.", { status: 500, headers: noStore });
    }
    const chunk = data ?? [];
    rows.push(
      ...chunk.map((x) => ({
        spent_on: x.spent_on,
        category: one(x.expense_categories)?.name ?? "",
        description: x.description,
        vendor: x.vendor,
        amount: x.amount,
        currency: x.currency,
        method: x.method,
        reference: x.reference,
        course: one(x.courses)?.title ?? "",
        batch: one(x.batches)?.name ?? "",
        status: x.status,
        receipt_url: x.receipt_url,
        notes: x.notes,
        void_reason: x.void_reason,
        created_by: x.created_by ? (members.get(x.created_by)?.name ?? "") : "",
        created_at: formatDateTime(x.created_at, tz),
      })),
    );
    if (chunk.length < CHUNK) break;
  }

  const { error: auditError } = await supabase.rpc("write_audit_log", {
    p_organization_id: orgId,
    p_action: "expenses.export",
    p_entity_type: "expenses",
    p_details: { rows: rows.length, truncated: rows.length >= MAX_ROWS, filters: Object.entries(filters).filter(([, v]) => v).map(([k]) => k) },
  });
  if (auditError) {
    console.error(JSON.stringify({ level: "error", msg: "export audit failed", code: auditError.code }));
    return new Response("Could not export expenses. Please try again.", { status: 500, headers: noStore });
  }

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  return new Response("﻿" + expensesCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses-${date}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
