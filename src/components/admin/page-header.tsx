import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { IconTile, type IconTileColor } from "@/components/ui/icon-tile";

export type Crumb = { label: string; href?: string };

/** Lightning "page header": object icon, eyebrow/breadcrumbs, title, actions, optional detail row. */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  color = "blue",
  eyebrow,
  crumbs,
  details,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  color?: IconTileColor;
  eyebrow?: string;
  crumbs?: Crumb[];
  details?: { label: string; value: ReactNode }[];
}) {
  return (
    <div className="mb-4 rounded-[var(--radius-card)] border border-line bg-surface/95 shadow-card backdrop-blur animate-fade-in">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {icon ? <IconTile icon={icon} color={color} size="lg" /> : null}
          <div className="min-w-0">
            {crumbs?.length ? (
              <nav aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
                  {crumbs.map((c, i) => (
                    <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                      {i > 0 ? <span aria-hidden>›</span> : null}
                      {c.href ? (
                        <Link href={c.href} className="hover:text-brand-600 hover:underline">
                          {c.label}
                        </Link>
                      ) : (
                        <span>{c.label}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            ) : eyebrow ? (
              <p className="text-xs text-muted">{eyebrow}</p>
            ) : null}
            <h1 className="truncate text-lg font-bold text-fg sm:text-xl">{title}</h1>
            {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {details?.length ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line px-4 py-3 sm:flex sm:flex-wrap">
          {details.map((d) => (
            <div key={d.label} className="min-w-0">
              <dt className="text-xs text-muted">{d.label}</dt>
              <dd className="truncate text-sm font-medium">{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
