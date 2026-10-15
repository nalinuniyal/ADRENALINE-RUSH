import "server-only";
import { cache } from "react";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import type { RegistrationField } from "@/lib/forms/registration";
import { isInclusionIcon, type InclusionIcon, type RegistrationMode } from "@/lib/validation/courses";

export type PublicInclusion = { title: string; description: string | null; icon: InclusionIcon | null };

export type PublicCourseSummary = {
  slug: string;
  title: string;
  short_description: string | null;
  cover_image_url: string | null;
  level: string | null;
  duration_text: string | null;
  delivery_mode: string;
  currency: string;
  show_price: boolean;
  list_price: number | null;
  discounted_price: number | null;
  registration_open: boolean;
  inclusions: PublicInclusion[];
  registration_mode: RegistrationMode;
  cta_label: string | null;
  highlight_badge: string | null;
  category: { name: string; slug: string } | null;
};

export type PublicCourse = PublicCourseSummary & {
  id: string;
  description: string | null;
  who_is_it_for: string | null;
  instructor_name: string | null;
  prerequisites: string | null;
  learning_outcomes: string[];
  certificate_details: string | null;
  faqs: { q: string; a: string }[];
  demo_url: string | null;
  success_message: string | null;
  enrollment_closes_on: string | null;
  modules: { title: string; description: string | null; lessons: { title: string; duration_minutes: number | null }[] }[];
};

export type PublicForm = {
  course: { id: string; slug: string; title: string; registration_open: boolean; success_message: string | null };
  fields: RegistrationField[];
};

function readInclusions(value: unknown): PublicInclusion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null && typeof r.title === "string" && r.title.trim() !== "")
    .map((r) => ({
      title: String(r.title).trim(),
      description: typeof r.description === "string" && r.description.trim() ? r.description.trim() : null,
      icon: isInclusionIcon(r.icon) ? r.icon : null,
    }));
}

/** Normalises the course-content fields so older databases (before migration 5) still render. */
function withContent<T extends Record<string, unknown>>(c: T) {
  return {
    ...c,
    inclusions: readInclusions(c.inclusions),
    registration_mode: c.registration_mode === "interest" ? "interest" : "demo",
    cta_label: typeof c.cta_label === "string" && c.cta_label.trim() ? c.cta_label.trim() : null,
    highlight_badge: typeof c.highlight_badge === "string" && c.highlight_badge.trim() ? c.highlight_badge.trim() : null,
  } as const;
}

export const getPublicCourses = cache(async (): Promise<PublicCourseSummary[]> => {
  const { data, error } = await createSupabasePublicClient().rpc("get_public_courses");
  if (error) throw new Error("Could not load courses");
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return rows.map((c) => withContent(c) as unknown as PublicCourseSummary);
});

export const getPublicCourse = cache(async (slug: string): Promise<PublicCourse | null> => {
  const { data, error } = await createSupabasePublicClient().rpc("get_public_course", { p_slug: slug });
  if (error) throw new Error("Could not load course");
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return withContent(data as Record<string, unknown>) as unknown as PublicCourse;
});

export const getPublicForm = cache(async (slug: string): Promise<PublicForm | null> => {
  const { data, error } = await createSupabasePublicClient().rpc("get_public_registration_form", { p_slug: slug });
  if (error) throw new Error("Could not load form");
  return (data as unknown as PublicForm) ?? null;
});
