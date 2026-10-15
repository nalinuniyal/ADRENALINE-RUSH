import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { AccessDenied } from "@/components/admin/access-denied";
import { requireAccess } from "@/lib/auth/session";
import { publicEnv } from "@/lib/env";
import { toDesign } from "@/lib/email/render";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TemplateFormInput } from "@/lib/validation/email";
import { EmailsHeader, EmailsSkeleton } from "../../_components/emails-header";
import { TemplateEditor } from "./template-editor";

export const metadata: Metadata = { title: "Edit email template" };

export default function TemplatePage({ params }: PageProps<"/admin/marketing/emails/templates/[id]">) {
  return (
    <Suspense fallback={<EmailsSkeleton label="Loading template" />}>
      <Template params={params} />
    </Suspense>
  );
}

async function Template({ params }: { params: PageProps<"/admin/marketing/emails/templates/[id]">["params"] }) {
  const { access, denied } = await requireAccess(["marketing.view"]);
  if (denied) return <AccessDenied />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const canManage = access.permissions.includes("marketing.manage");

  const supabase = await createSupabaseServerClient();
  const { data: t, error } = await supabase
    .from("email_templates")
    .select("id, name, audience, subject, preheader, design, custom_html, use_custom_html, email_automations(count)")
    .eq("id", id)
    .eq("organization_id", access.organization.id)
    .maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "email template read failed", code: error.code }));
    throw new Error("Could not load the template.");
  }
  if (!t) notFound();
  const uses = (t.email_automations as unknown as { count: number }[] | null)?.[0]?.count ?? 0;

  const d = toDesign(t.design);
  const initial: TemplateFormInput = {
    name: t.name,
    audience: t.audience === "team" ? "team" : "candidate",
    subject: t.subject,
    preheader: t.preheader ?? "",
    headerImageUrl: d.header_image_url ?? "",
    headerImageAssetId: d.header_image_asset_id ?? "",
    heading: d.heading ?? "",
    body: d.body ?? "",
    buttonLabel: d.button_label ?? "",
    buttonUrl: d.button_url ?? "",
    footerText: d.footer_text ?? "",
    accentColor: d.accent_color && /^#[0-9a-f]{6}$/i.test(d.accent_color) ? d.accent_color : "#0176d3",
    useCustomHtml: t.use_custom_html,
    customHtml: t.custom_html ?? "",
  };

  return (
    <>
      <EmailsHeader
        active="templates"
        title={t.name}
        crumbs={[
          { label: "Marketing", href: "/admin/marketing" },
          { label: "Emails", href: "/admin/marketing/emails" },
          { label: t.name },
        ]}
        description={uses ? `Used by ${uses} automation${uses === 1 ? "" : "s"}: saved changes apply to the next email sent.` : "Not used by an automation yet. Add one under Automations."}
      />
      <TemplateEditor
        templateId={t.id}
        initial={initial}
        readOnly={!canManage}
        siteUrl={publicEnv().NEXT_PUBLIC_SITE_URL}
        businessName={access.organization.name}
        userEmail={access.email}
      />
    </>
  );
}
