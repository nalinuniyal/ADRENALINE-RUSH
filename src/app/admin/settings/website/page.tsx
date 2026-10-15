import type { Metadata } from "next";
import { Suspense } from "react";
import { Globe } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SiteSettingsInput } from "@/lib/validation/site-settings";
import { WebsiteSettingsForm } from "./website-form";

export const metadata: Metadata = { title: "Website settings" };

export default function WebsiteSettingsPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <WebsiteSettings />
    </Suspense>
  );
}

async function WebsiteSettings() {
  const { access, denied } = await requireAccess(["settings.manage"]);
  if (denied) return <AccessDenied />;
  const org = access.organization.id;

  const supabase = await createSupabaseServerClient();
  const [settingsRes, coursesRes] = await Promise.all([
    supabase.from("site_settings").select("*").eq("organization_id", org).maybeSingle(),
    supabase.from("courses").select("id, title, status").eq("organization_id", org).neq("status", "archived").order("title"),
  ]);
  if (settingsRes.error || coursesRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "website settings read failed", code: (settingsRes.error ?? coursesRes.error)?.code }));
    throw new Error("Could not load the website settings.");
  }

  const header = (
    <PageHeader
      title="Website"
      icon={Globe}
      color="teal"
      crumbs={[{ label: "Settings", href: "/admin/settings" }, { label: "Website" }]}
      description="What visitors see on your public site. Empty fields fall back to the built-in text or are hidden."
    />
  );

  const s = settingsRes.data;
  if (!s) {
    return (
      <>
        {header}
        <Alert tone="warning" title="Website settings are not set up yet">
          Run the latest supabase/setup.sql in the Supabase SQL Editor, then reload this page.
        </Alert>
      </>
    );
  }

  const str = (v: string | null) => v ?? "";
  const initial: SiteSettingsInput = {
    heroTitle: str(s.hero_title),
    heroSubtitle: str(s.hero_subtitle),
    heroBadge: str(s.hero_badge),
    featuredCourseId: str(s.featured_course_id),
    aboutText: str(s.about_text),
    contactEmail: str(s.contact_email),
    contactPhone: str(s.contact_phone),
    whatsappNumber: str(s.whatsapp_number),
    address: str(s.address),
    linkedinUrl: str(s.linkedin_url),
    instagramUrl: str(s.instagram_url),
    youtubeUrl: str(s.youtube_url),
    xUrl: str(s.x_url),
    facebookUrl: str(s.facebook_url),
    footerTagline: str(s.footer_tagline),
    showCourseCatalog: s.show_course_catalog,
  };

  return (
    <>
      {header}
      <Card>
        <CardContent className="py-5">
          <WebsiteSettingsForm initial={initial} courses={(coursesRes.data ?? []).map((c) => ({ id: c.id, title: c.title, published: c.status === "published" }))} />
        </CardContent>
      </Card>
    </>
  );
}
