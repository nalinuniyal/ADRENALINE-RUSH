import type { ReactNode } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { PageHeader, type Crumb } from "@/components/admin/page-header";
import { cn } from "@/lib/utils";

export type EmailsTab = "templates" | "automations" | "log" | "settings";

const TABS: { key: EmailsTab; label: string; href: string }[] = [
  { key: "templates", label: "Templates", href: "/admin/marketing/emails" },
  { key: "automations", label: "Automations", href: "/admin/marketing/emails/automations" },
  { key: "log", label: "Email log", href: "/admin/marketing/emails/log" },
  { key: "settings", label: "Settings", href: "/admin/marketing/emails/settings" },
];

/** Page header + section tabs shared by every email page. */
export function EmailsHeader({
  active,
  title = "Emails",
  description,
  actions,
  crumbs,
}: {
  active: EmailsTab;
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <>
      <PageHeader
        title={title}
        icon={Mail}
        color="indigo"
        crumbs={crumbs ?? [{ label: "Marketing", href: "/admin/marketing" }, { label: "Emails" }]}
        description={description}
        actions={actions}
      />
      <nav aria-label="Email sections" className="mb-4 overflow-x-auto">
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

export function EmailsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="ar-skeleton mb-4 h-20 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton mb-4 h-10 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton h-72 rounded-[var(--radius-card)]" />
    </div>
  );
}
