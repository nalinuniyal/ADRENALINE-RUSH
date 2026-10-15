import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, FileText, Inbox, Mail, Megaphone, Settings2, Zap, type LucideIcon } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile, type IconTileColor } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { emailProviderStatus } from "@/lib/email/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Marketing" };

export default function MarketingPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[50vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading marketing" />}>
      <Marketing />
    </Suspense>
  );
}

const LINKS: { href: string; title: string; text: string; icon: LucideIcon; color: IconTileColor }[] = [
  { href: "/admin/marketing/emails", title: "Email templates", text: "Edit the confirmation and notification emails, with images.", icon: FileText, color: "indigo" },
  { href: "/admin/marketing/emails/automations", title: "Automations", text: "Choose which email is sent, to whom, for which course.", icon: Zap, color: "orange" },
  { href: "/admin/marketing/emails/log", title: "Email log", text: "See every email sent, failed or not sent.", icon: Inbox, color: "teal" },
  { href: "/admin/marketing/emails/settings", title: "Email settings", text: "Team recipients, reply-to and the email provider.", icon: Settings2, color: "slate" },
];

async function Marketing() {
  const { access, denied } = await requireAccess(["marketing.view"]);
  if (denied) return <AccessDenied />;
  const provider = emailProviderStatus().active;
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("email_automations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", access.organization.id)
    .eq("is_active", true);

  return (
    <>
      <PageHeader title="Marketing & Emails" icon={Megaphone} color="indigo" description="Automatic emails today; campaigns and tracked links arrive in a later delivery." />
      <Card>
        <CardHeader
          icon={<IconTile icon={Mail} color="indigo" size="sm" />}
          actions={<Badge tone={provider ? "success" : "warning"}>{provider ? "Sending enabled" : "No email provider yet"}</Badge>}
        >
          <CardTitle>Emails</CardTitle>
          <CardDescription>
            {count ?? 0} automation{count === 1 ? "" : "s"} switched on. Candidates who book a demo get a confirmation and your team gets a notification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="group flex h-full items-start gap-3 rounded-lg border border-line p-3 transition hover:border-brand-300 hover:bg-brand-50/50">
                  <IconTile icon={l.icon} color={l.color} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-semibold text-brand-700">
                      {l.title} <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    <span className="block text-sm text-muted">{l.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
