"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteSettingsSchema } from "@/lib/validation/site-settings";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string[] | undefined> };

/** Settings › Website. RLS (settings.manage) enforces the same rule again in the database. */
export async function updateSiteSettings(input: unknown): Promise<ActionResult> {
  const access = await assertPermission(["settings.manage"]);
  const parsed = siteSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const org = access.organization.id;
  const supabase = await createSupabaseServerClient();

  if (v.featuredCourseId) {
    const { data: course } = await supabase.from("courses").select("id").eq("id", v.featuredCourseId).eq("organization_id", org).maybeSingle();
    if (!course) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { featuredCourseId: ["That course no longer exists. Choose another one."] } };
  }

  const { data, error } = await supabase
    .from("site_settings")
    .update({
      hero_title: v.heroTitle,
      hero_subtitle: v.heroSubtitle,
      hero_badge: v.heroBadge,
      featured_course_id: v.featuredCourseId,
      about_text: v.aboutText,
      contact_email: v.contactEmail,
      contact_phone: v.contactPhone,
      whatsapp_number: v.whatsappNumber,
      address: v.address,
      linkedin_url: v.linkedinUrl,
      instagram_url: v.instagramUrl,
      youtube_url: v.youtubeUrl,
      x_url: v.xUrl,
      facebook_url: v.facebookUrl,
      footer_tagline: v.footerTagline,
      show_course_catalog: v.showCourseCatalog,
    })
    .eq("organization_id", org)
    .select("organization_id");

  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "site settings update failed", code: error.code }));
    if (error.code === "23514") return { ok: false, message: "Some values were not accepted. Check the form and try again." };
    return { ok: false, message: "Could not save the website settings. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "Website settings were not found. Run the latest supabase/setup.sql and try again." };

  revalidatePath("/admin/settings/website");
  // Every public page can show these settings (header, footer, home).
  revalidatePath("/", "layout");
  return { ok: true, message: "Website settings saved. Your public pages are updated." };
}
