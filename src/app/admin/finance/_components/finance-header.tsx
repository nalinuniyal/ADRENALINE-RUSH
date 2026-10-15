import type { ReactNode } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { PageHeader, type Crumb } from "@/components/admin/page-header";
import { cn } from "@/lib/utils";

export type FinanceTab = "overview" | "fees" | "payments" | "verify" | "expenses";

const TABS: { key: FinanceTab; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/admin/finance" },
  { key: "fees", label: "Fees & dues", href: "/admin/finance/fees" },
  { key: "payments", label: "Payments", href: "/admin/finance/payments" },
  { key: "verify", label: "To verify", href: "/admin/finance/verify" },
  { key: "expenses", label: "Expenses", href: "/admin/finance/expenses" },
];

/** Page header + section tabs shared by every finance page. */
export function FinanceHeader({
  active,
  title = "Payments & Expenses",
  description,
  actions,
  crumbs,
}: {
  active: FinanceTab;
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <>
      <PageHeader title={title} icon={Wallet} color="green" crumbs={crumbs} description={description} actions={actions} />
      <nav aria-label="Finance sections" className="mb-4 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={t.key === active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition",
                  t.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export function FinanceSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="ar-skeleton mb-4 h-20 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton mb-4 h-10 rounded-[var(--radius-card)]" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ar-skeleton h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div className="ar-skeleton h-72 rounded-[var(--radius-card)]" />
    </div>
  );
}
