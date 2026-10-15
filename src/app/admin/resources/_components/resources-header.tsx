import type { ReactNode } from "react";
import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { PageHeader, type Crumb } from "@/components/admin/page-header";
import { cn } from "@/lib/utils";

export type ResourcesTab = "library" | "share" | "templates" | "history";

const TABS: { key: ResourcesTab; label: string; href: string }[] = [
  { key: "library", label: "Library", href: "/admin/resources" },
  { key: "share", label: "Share", href: "/admin/resources/share" },
  { key: "templates", label: "Message templates", href: "/admin/resources/templates" },
  { key: "history", label: "Share history", href: "/admin/resources/history" },
];

/** Page header + section tabs shared by every Demos & Resources page. */
export function ResourcesHeader({
  active,
  title = "Demos & Resources",
  description,
  actions,
  crumbs,
}: {
  active: ResourcesTab | null;
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <>
      <PageHeader title={title} icon={PlayCircle} color="orange" crumbs={crumbs} description={description} actions={actions} />
      <nav aria-label="Demos and resources sections" className="mb-4 overflow-x-auto">
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

export function ResourcesSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="ar-skeleton mb-4 h-20 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton mb-4 h-10 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton h-72 rounded-[var(--radius-card)]" />
    </div>
  );
}
