import { Rocket } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { NAV_COLORS, NAV_ICONS } from "@/components/admin/nav-icons";
import { PageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { navItemFor } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";

/**
 * Server-guarded page for a module that a later delivery stage adds.
 * Permission is enforced here (not just by hiding the nav link).
 */
export async function ModulePlaceholder({ href, summary }: { href: string; summary: string }) {
  const item = navItemFor(href);
  if (!item) throw new Error(`Unknown module ${href}`);
  const { denied } = await requireAccess(item.requires);
  if (denied) return <AccessDenied />;

  return (
    <>
      <PageHeader title={item.label} description={summary} icon={NAV_ICONS[item.icon]} color={NAV_COLORS[item.icon]} />
      <EmptyState
        icon={<Rocket className="size-6" aria-hidden />}
        title="Arriving in the next delivery"
        description="This module is on the roadmap and is not switched on yet. No sample data is shown."
      />
    </>
  );
}
