import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, Mail, Zap } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmailsHeader, EmailsSkeleton } from "./_components/emails-header";
import { NewTemplateForm, TemplateRowActions } from "./_components/template-list-actions";

export const metadata: Metadata = { title: "Email templates" };

export default function EmailTemplatesPage() {
  return (
    <Suspense fallback={<EmailsSkeleton label="Loading email templates" />}>
      <Templates />
    </Suspense>
  );
}

async function Templates() {
  const { access, denied } = await requireAccess(["marketing.view"]);
  if (denied) return <AccessDenied />;
  const canManage = access.permissions.includes("marketing.manage");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("email_templates")
    .select("id, name, audience, subject, use_custom_html, updated_at, email_automations(count)")
    .eq("organization_id", access.organization.id)
    .order("name");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "email template list failed", code: error.code }));
    throw new Error("Could not load email templates.");
  }
  const templates = (data ?? []).map((t) => ({ ...t, uses: (t.email_automations as unknown as { count: number }[] | null)?.[0]?.count ?? 0 }));

  return (
    <>
      <EmailsHeader
        active="templates"
        description="The emails candidates and your team receive. Edit the words and images here; automations decide when they are sent."
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] lg:items-start">
        <Card>
          <CardHeader icon={<IconTile icon={FileText} color="indigo" size="sm" />}>
            <CardTitle>Templates</CardTitle>
            <CardDescription>{templates.length ? `${templates.length} template${templates.length === 1 ? "" : "s"}` : "None yet"}</CardDescription>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <EmptyState
                icon={<Mail className="size-6" aria-hidden />}
                title="No email templates"
                description={canManage ? "Create a template, then use it in an automation." : "Templates will appear here once someone with marketing access creates them."}
              />
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {templates.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/marketing/emails/templates/${t.id}`} className="font-semibold break-words text-brand-700 hover:underline">
                        {t.name}
                      </Link>
                      <p className="truncate text-sm text-[#444]" title={t.subject}>
                        {t.subject}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <Badge tone={t.audience === "team" ? "violet" : "teal"}>{t.audience === "team" ? "To your team" : "To candidates"}</Badge>
                        {t.use_custom_html ? <Badge>Custom HTML</Badge> : null}
                        <span className="inline-flex items-center gap-1">
                          <Zap className="size-3" aria-hidden />
                          {t.uses ? `Used by ${t.uses} automation${t.uses === 1 ? "" : "s"}` : "Not used by an automation"}
                        </span>
                        <span>· Updated {formatDate(t.updated_at, access.organization.timezone)}</span>
                      </p>
                    </div>
                    <TemplateRowActions id={t.id} name={t.name} canManage={canManage} inUse={t.uses > 0} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>New template</CardTitle>
              <CardDescription>Starts with editable example text.</CardDescription>
            </CardHeader>
            <CardContent>
              <NewTemplateForm />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
