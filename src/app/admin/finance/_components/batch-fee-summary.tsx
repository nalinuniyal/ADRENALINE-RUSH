import Link from "next/link";
import { Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import type { Access } from "@/lib/auth/session";
import { getFinanceSummary } from "@/lib/data/finance";
import { formatPaise } from "@/lib/finance/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Small fee/collection summary on a batch page, for finance.view holders only. */
export async function BatchFeeSummary({ batchId, access }: { batchId: string; access: Access }) {
  if (!access.permissions.includes("finance.view")) return null;
  const supabase = await createSupabaseServerClient();
  const s = await getFinanceSummary(supabase, access.organization.id, { from: "", to: "", course: "", batch: batchId });
  const rows: [string, number, string?][] = [
    ["Booked fees", s.booked],
    ["Collected (net)", s.net],
    ["Outstanding", s.outstanding, s.outstanding ? "text-warning-700" : undefined],
    ["Overdue", s.overdue, s.overdue ? "text-danger-700" : undefined],
  ];
  return (
    <Card>
      <CardHeader
        icon={<IconTile icon={Wallet} color="green" size="sm" />}
        actions={
          <Link href={`/admin/finance/fees?batch=${batchId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Fees
          </Link>
        }
      >
        <CardTitle>Fees</CardTitle>
        <CardDescription>Students in this batch, in {s.currency}.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3">
          {rows.map(([label, value, cls]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={`text-sm font-semibold tabular-nums ${cls ?? ""}`}>{formatPaise(value, s.currency)}</dd>
            </div>
          ))}
        </dl>
        {s.overdueCount ? <p className="mt-2 text-xs text-danger-700">{s.overdueCount} overdue installment{s.overdueCount === 1 ? "" : "s"}.</p> : null}
      </CardContent>
    </Card>
  );
}
