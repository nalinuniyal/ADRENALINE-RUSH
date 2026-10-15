import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { EMPTY_PUBLIC_SITE, parsePublicSite, type PublicSite } from "@/lib/public-site";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export {
  courseCtaLabel,
  EMPTY_PUBLIC_SITE,
  telLink,
  whatsappLink,
  type PublicFeaturedCourse,
  type PublicSite,
  type PublicSocialLinks,
} from "@/lib/public-site";

/**
 * Website settings for public pages. Never throws: if the database is
 * unreachable the site renders with its built-in copy and no contact details.
 */
export const getPublicSite = cache(async (): Promise<PublicSite> => {
  // Settings change at any time: read them per request, never at build time.
  await connection();
  const { data, error } = await createSupabasePublicClient().rpc("get_public_site");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "public site settings read failed", code: error.code || error.message?.slice(0, 80) }));
    return EMPTY_PUBLIC_SITE;
  }
  return parsePublicSite(data);
});
