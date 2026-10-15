import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { createSupabasePublicClient } from "@/lib/supabase/public";

export type PublicResourceCourse = {
  slug: string;
  title: string;
  short_description: string | null;
  registration_open: boolean;
  registration_mode: "demo" | "interest";
  cta_label: string | null;
};

export type PublicResource = {
  slug: string;
  title: string;
  type: string;
  description: string | null;
  url: string;
  thumbnail_url: string | null;
  access_instructions: string | null;
  organization_name: string | null;
  courses: PublicResourceCourse[];
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const https = (v: unknown): string | null => {
  const s = text(v);
  return s && /^https:\/\/\S+$/i.test(s) && URL.canParse(s) ? s : null;
};

/** Defensive parse of get_public_resource(): unknown shapes are dropped, links must be https. */
export function parsePublicResource(data: unknown): PublicResource | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const url = https(d.url);
  if (typeof d.slug !== "string" || typeof d.title !== "string" || !url) return null;
  const courses = Array.isArray(d.courses) ? (d.courses as Record<string, unknown>[]) : [];
  return {
    slug: d.slug,
    title: d.title,
    type: typeof d.type === "string" ? d.type : "link",
    description: text(d.description),
    url,
    thumbnail_url: https(d.thumbnail_url),
    access_instructions: text(d.access_instructions),
    organization_name: text(d.organization_name),
    courses: courses
      .filter((c) => c && typeof c.slug === "string" && typeof c.title === "string")
      .map((c) => ({
        slug: c.slug as string,
        title: c.title as string,
        short_description: text(c.short_description),
        registration_open: c.registration_open === true,
        registration_mode: c.registration_mode === "interest" ? "interest" : "demo",
        cta_label: text(c.cta_label),
      })),
  };
}

export const getPublicResource = cache(async (slug: string): Promise<PublicResource | null> => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 90) return null;
  // Read per request: switching a resource off (or its expiry) must take effect immediately.
  await connection();
  const { data, error } = await createSupabasePublicClient().rpc("get_public_resource", { p_slug: slug });
  if (error) throw new Error("Could not load this page");
  return parsePublicResource(data);
});
