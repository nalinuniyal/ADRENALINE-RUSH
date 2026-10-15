import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/access-denied";
import { requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmailsHeader, EmailsSkeleton } from "../_components/emails-header";
import { AutomationManager, type AutomationRow } from "./automation-manager";

export const metadata: Metadata = { title: "Email automations" };

export default function AutomationsPage() {
  return (
    <Suspense fallback={<EmailsSkeleton label="Loading email automations" />}>
      <Automations />
    </Suspense>
  );
}

async function Automations() {
  const { access, denied } = await requireAccess(["marketing.view"]);
  if (denied) return <AccessDenied />;
  const canManage = access.permissions.includes("marketing.manage");
  const org = access.organization.id;

  const supabase = await createSupabaseServerClient();
  const [autoRes, tplRes, courseRes] = await Promise.all([
    supabase
      .from("email_automations")
      .select("id, name, course_id, channel, recipient, custom_emails, template_id, is_active")
      .eq("organization_id", org)
      .order("created_at"),
    supabase.from("email_templates").select("id, name, audience").eq("organization_id", org).order("name"),
    // Course names need courses.view; without it the filter shows "a course".
    supabase.from("courses").select("id, title, status").eq("organization_id", org).neq("status", "archived").order("title"),
  ]);
  if (autoRes.error || tplRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "email automation list failed", code: (autoRes.error ?? tplRes.error)?.code }));
    throw new Error("Could not load email automations.");
  }

  return (
    <>
      <EmailsHeader
        active="automations"
        description="When a candidate books a demo or registers, matching automations send their template. A rule for “All courses” also covers courses you add later."
      />
      <AutomationManager
        automations={(autoRes.data ?? []) as AutomationRow[]}
        templates={(tplRes.data ?? []).map((t) => ({ id: t.id, name: t.name, audience: t.audience }))}
        courses={(courseRes.data ?? []).map((c) => ({ id: c.id, title: c.status === "draft" ? `${c.title} (draft)` : c.title }))}
        canManage={canManage}
      />
    </>
  );
}
