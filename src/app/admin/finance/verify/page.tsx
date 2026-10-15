import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BadgeCheck } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAccess } from "@/lib/auth/session";
import { getPaymentSettings, loadSubmissionViews } from "@/lib/data/pay-links";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { FinanceHeader, FinanceSkeleton } from "../_components/finance-header";
import { SubmissionList } from "../_components/submission-list";

export const metadata: Metadata = { title: "Payments to verify" };

const STATUSES = [
  { key: "pending", label: "To verify" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

export default function VerifyPage({ searchParams }: PageProps<"/admin/finance/verify">) {
  return (
    <Suspense fallback={<FinanceSkeleton label="Loading payments to verify" />}>
      <Verify searchParams={searchParams} />
    </Suspense>
  );
}

async function Verify({ searchParams }: { searchParams: PageProps<"/admin/finance/verify">["searchParams"] }) {
  const { access, denied } = await requireAccess(["finance.view"]);
  if (denied) return <AccessDenied />;
  const sp = await searchParams;
  const status = STATUSES.find((s) => s.key === sp.status)?.key ?? "pending";
  const orgId = access.organization.id;
  const canManage = access.permissions.includes("finance.manage");
  const supabase = await createSupabaseServerClient();
  const [items, settings] = await Promise.all([loadSubmissionViews(supabase, orgId, access.organization.timezone, { status }), getPaymentSettings(supabase, orgId)]);
  const configured = Boolean(settings?.upiVpa || settings?.bankAccountLast4);

  return (
    <>
      <FinanceHeader
        active="verify"
        description="UPI and bank transfers that students reported on their pay page. Check each UTR in your bank or UPI app, then approve to record the payment and issue a receipt."
        actions={
          canManage || access.permissions.includes("settings.manage") ? (
            <Link href="/admin/settings/payments" className={buttonVariants({ variant: "secondary" })}>
              Payment details
            </Link>
          ) : undefined
        }
      />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s.key}
            href={s.key === "pending" ? "/admin/finance/verify" : `/admin/finance/verify?status=${s.key}`}
            aria-current={s.key === status ? "page" : undefined}
            className={cn(buttonVariants({ variant: s.key === status ? "primary" : "secondary", size: "sm" }))}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <SubmissionList
        items={items}
        canManage={canManage}
        empty={
            <EmptyState
              icon={<BadgeCheck className="size-6 text-brand-600" aria-hidden />}
              title={status === "pending" ? "Nothing to verify" : `No ${status} reports`}
              description={
                configured
                  ? "When a student pays by UPI or bank transfer and enters the UTR on their pay page, it appears here."
                  : "Add your UPI ID or bank details first, then send students their pay link from Fees & dues."
              }
            />
        }
      />
    </>
  );
}
