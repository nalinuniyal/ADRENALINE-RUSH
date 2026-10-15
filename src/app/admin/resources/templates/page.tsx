import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/access-denied";
import { requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResourcesHeader, ResourcesSkeleton } from "../_components/resources-header";
import { TemplateManager } from "./template-manager";

export const metadata: Metadata = { title: "Message templates" };

export default function ShareTemplatesPage() {
  return (
    <Suspense fallback={<ResourcesSkeleton label="Loading message templates" />}>
      <Templates />
    </Suspense>
  );
}

async function Templates() {
  const { access, denied } = await requireAccess(["resources.view"]);
  if (denied) return <AccessDenied />;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("share_templates")
    .select("id, name, channel, subject, body, updated_at")
    .eq("organization_id", access.organization.id)
    .order("position")
    .order("name");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "share template list failed", code: error.code }));
    throw new Error("Could not load message templates. If you just updated the app, run the latest supabase/setup.sql.");
  }
  return (
    <>
      <ResourcesHeader
        active="templates"
        description="Reusable WhatsApp and email messages for sharing demos and resources. Placeholders like {{first_name}} are filled in for each candidate."
      />
      <TemplateManager templates={data ?? []} canManage={access.permissions.includes("resources.manage")} businessName={access.organization.name} />
    </>
  );
}
