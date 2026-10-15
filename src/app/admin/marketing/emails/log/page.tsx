import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/validation/courses";
import { emailLogFilterSchema } from "@/lib/validation/email";
import { EmailsHeader, EmailsSkeleton } from "../_components/emails-header";

export const metadata: Metadata = { title: "Email log" };

const PAGE_SIZE = 50;
const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  not_sent: { label: "Not sent", tone: "warning" },
};

export default function EmailLogPage({ searchParams }: PageProps<"/admin/marketing/emails/log">) {
  return (
    <Suspense fallback={<EmailsSkeleton label="Loading email log" />}>
      <EmailLog searchParams={searchParams} />
    </Suspense>
  );
}

async function EmailLog({ searchParams }: { searchParams: PageProps<"/admin/marketing/emails/log">["searchParams"] }) {
  const { access, denied } = await requireAccess(["marketing.view"]);
  if (denied) return <AccessDenied />;
  const raw = await searchParams;
  const filters = emailLogFilterSchema.parse({ status: firstParam(raw.status), page: firstParam(raw.page) });
  const tz = access.organization.timezone;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("email_log")
    .select("id, kind, to_address, subject, status, provider, error, created_at, candidate_id, candidates(full_name), email_automations(name)", { count: "exact" })
    .eq("organization_id", access.organization.id);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error && error.code !== "PGRST103") {
    console.error(JSON.stringify({ level: "error", msg: "email log list failed", code: error.code }));
    throw new Error("Could not load the email log.");
  }
  const rows = (data ?? []).map((r) => {
    const cand = Array.isArray(r.candidates) ? r.candidates[0] : r.candidates;
    const auto = Array.isArray(r.email_automations) ? r.email_automations[0] : r.email_automations;
    return { ...r, candidateName: cand?.full_name ?? null, automationName: auto?.name ?? null };
  });
  const total = count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    const qs = new URLSearchParams();
    if (next.status !== "all") qs.set("status", next.status);
    if (next.page > 1) qs.set("page", String(next.page));
    const s = qs.toString();
    return s ? `/admin/marketing/emails/log?${s}` : "/admin/marketing/emails/log";
  };

  return (
    <>
      <EmailsHeader active="log" description="Every email the system tried to send, with its real result. “Not sent” means nothing left the system (for example, no provider is set up)." />
      <Card className="mb-4">
        <Form key={filters.status} action="/admin/marketing/emails/log" aria-label="Filter email log" className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="log-status" className="text-xs font-medium text-[#444]">
              Status
            </label>
            <Select id="log-status" name="status" defaultValue={filters.status}>
              <option value="all">All statuses</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="not_sent">Not sent</option>
            </Select>
          </div>
          <button type="submit" className={buttonVariants()}>
            Apply
          </button>
          {filters.status !== "all" ? (
            <Link href="/admin/marketing/emails/log" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </Form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={filters.status === "all" ? "No emails yet" : "No emails with this status"}
          description="Emails appear here when an automation runs or you send a test."
        />
      ) : (
        <Card className="overflow-hidden">
          <p className="sr-only" aria-live="polite">
            {total} email{total === 1 ? "" : "s"}
          </p>
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const s = STATUS[r.status] ?? { label: r.status, tone: "neutral" as BadgeTone };
              return (
                <li key={r.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr_auto] sm:gap-4">
                  <p className="text-xs whitespace-nowrap text-muted sm:pt-0.5">{formatDateTime(r.created_at, tz)}</p>
                  <div className="min-w-0">
                    <p className="font-medium break-words">{r.subject || "(no subject)"}</p>
                    <p className="text-xs break-all text-muted">
                      To {r.to_address ?? "—"}
                      {r.candidate_id ? (
                        <>
                          {" · "}
                          <Link href={`/admin/candidates/${r.candidate_id}`} className="text-brand-700 hover:underline">
                            {r.candidateName ?? "candidate"}
                          </Link>
                        </>
                      ) : null}
                      {" · "}
                      {r.kind === "test" ? "Test email" : r.kind === "share" ? "Shared resources" : r.kind === "fee_reminder" ? "Fee reminder" : (r.automationName ?? "Automation (deleted)")}
                      {r.provider ? ` · via ${r.provider === "smtp" ? "SMTP" : "Resend"}` : ""}
                    </p>
                    {r.error ? <p className="mt-1 text-xs break-words text-danger-700">{r.error}</p> : null}
                  </div>
                  <div>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">
                Page {filters.page} of {pages}
              </span>
              <span className="flex gap-2">
                {filters.page > 1 ? (
                  <Link href={href({ page: filters.page - 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="prev">
                    <ChevronLeft className="size-4" aria-hidden /> Previous
                  </Link>
                ) : null}
                {filters.page < pages ? (
                  <Link href={href({ page: filters.page + 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="next">
                    Next <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : null}
        </Card>
      )}
    </>
  );
}
