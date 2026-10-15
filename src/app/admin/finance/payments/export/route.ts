import type { NextRequest } from "next/server";
import { hasAny } from "@/lib/auth/permissions";
import { getAccess } from "@/lib/auth/session";
import { getMemberNames } from "@/lib/data/candidates";
import { paymentsQuery, toPaymentRow, type PaymentListRow } from "@/lib/data/finance";
import { paymentsCsv } from "@/lib/finance/export";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseFinanceFilters } from "@/lib/validation/finance";

const CHUNK = 1000;
const MAX_ROWS = 20_000;
const noStore = { "Cache-Control": "no-store" };

/** CSV of payments with the same filters as the list. Needs finance.view AND reports.export; RLS applies. */
export async function GET(request: NextRequest) {
  const result = await getAccess();
  if (result.status !== "ok") return new Response("Sign in to export payments.", { status: 401, headers: noStore });
  const access = result.access;
  if (!hasAny(access.permissions, ["finance.view"]) || !hasAny(access.permissions, ["reports.export"])) {
    return new Response("You do not have permission to export payments.", { status: 403, headers: noStore });
  }
  const filters = parseFinanceFilters(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const supabase = await createSupabaseServerClient();

  const rows: PaymentListRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await paymentsQuery(supabase, orgId, filters).range(from, from + CHUNK - 1);
    if (error) {
      if (error.code === "PGRST103") break;
      console.error(JSON.stringify({ level: "error", msg: "payment export failed", code: error.code }));
      return new Response("Could not export payments. Please try again.", { status: 500, headers: noStore });
    }
    const chunk = (data ?? []).map((r) => toPaymentRow(r as never));
    rows.push(...chunk);
    if (chunk.length < CHUNK) break;
  }
  const list = filters.status === "refunded" ? rows.filter((r) => r.refunded > 0) : rows;
  const members = await getMemberNames(supabase, orgId);
  const body = paymentsCsv(
    list.map((p) => ({
      receipt_number: p.receiptNumber,
      paid_on: p.paidOn,
      candidate: p.candidateName,
      course: p.courseTitle,
      batch: p.batchName ?? "",
      amount: p.amount / 100,
      refunded: p.refunded / 100,
      currency: p.currency,
      method: p.method,
      status: p.status,
      reference: p.reference,
      installment: p.installment,
      notes: p.notes,
      void_reason: p.voidReason,
      recorded_by: p.recordedBy ? (members.get(p.recordedBy)?.name ?? "") : p.gateway ? "Razorpay webhook" : "",
      created_at: formatDateTime(p.createdAt, tz),
    })),
  );

  // Money exports are audited; an export that cannot be audited is not handed out.
  const { error: auditError } = await supabase.rpc("write_audit_log", {
    p_organization_id: orgId,
    p_action: "payments.export",
    p_entity_type: "payments",
    p_details: { rows: list.length, truncated: rows.length >= MAX_ROWS, filters: Object.entries(filters).filter(([, v]) => v).map(([k]) => k) },
  });
  if (auditError) {
    console.error(JSON.stringify({ level: "error", msg: "export audit failed", code: auditError.code }));
    return new Response("Could not export payments. Please try again.", { status: 500, headers: noStore });
  }

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  return new Response("﻿" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payments-${date}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
