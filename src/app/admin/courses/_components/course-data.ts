import type { Database } from "@/lib/database.types";
import { isInclusionIcon, type CourseFormInput, type InclusionRow } from "@/lib/validation/courses";

type CourseRow = Database["public"]["Tables"]["courses"]["Row"];

export const COURSE_COLUMNS =
  "id, title, slug, status, category_id, short_description, description, who_is_it_for, cover_image_url, instructor_name, level, prerequisites, learning_outcomes, duration_text, delivery_mode, list_price, discounted_price, currency, show_price, capacity, enrollment_opens_on, enrollment_closes_on, certificate_details, faqs, demo_url, success_message, inclusions, registration_mode, cta_label, highlight_badge, published_at, created_at, updated_at" as const;

function readFaqs(value: unknown): { q: string; a: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is { q: unknown; a: unknown } => typeof f === "object" && f !== null)
    .map((f) => ({ q: typeof f.q === "string" ? f.q : "", a: typeof f.a === "string" ? f.a : "" }))
    .filter((f) => f.q || f.a);
}

function readInclusions(value: unknown): InclusionRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "",
      description: typeof r.description === "string" ? r.description : "",
      icon: isInclusionIcon(r.icon) ? r.icon : ("" as const),
    }))
    .filter((r) => r.title);
}

export function emptyCourseForm(currency: string): CourseFormInput {
  return {
    title: "",
    slug: "",
    categoryId: "",
    shortDescription: "",
    description: "",
    whoIsItFor: "",
    coverImageUrl: "",
    instructorName: "",
    level: "",
    prerequisites: "",
    learningOutcomes: "",
    durationText: "",
    deliveryMode: "online",
    listPrice: "",
    discountedPrice: "",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "INR",
    showPrice: true,
    capacity: "",
    enrollmentOpensOn: "",
    enrollmentClosesOn: "",
    certificateDetails: "",
    faqs: [],
    demoUrl: "",
    successMessage: "",
    inclusions: [],
    registrationMode: "demo",
    ctaLabel: "",
    highlightBadge: "",
  };
}

const str = (v: string | null | undefined) => v ?? "";
const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function courseToForm(c: Omit<CourseRow, "organization_id" | "created_by" | "course_is_open" | "public_course_json">): CourseFormInput {
  return {
    title: c.title,
    slug: c.slug,
    categoryId: str(c.category_id),
    shortDescription: str(c.short_description),
    description: str(c.description),
    whoIsItFor: str(c.who_is_it_for),
    coverImageUrl: str(c.cover_image_url),
    instructorName: str(c.instructor_name),
    level: str(c.level),
    prerequisites: str(c.prerequisites),
    learningOutcomes: (c.learning_outcomes ?? []).join("\n"),
    durationText: str(c.duration_text),
    deliveryMode: c.delivery_mode,
    listPrice: num(c.list_price),
    discountedPrice: num(c.discounted_price),
    currency: c.currency.trim(),
    showPrice: c.show_price,
    capacity: num(c.capacity),
    enrollmentOpensOn: str(c.enrollment_opens_on),
    enrollmentClosesOn: str(c.enrollment_closes_on),
    certificateDetails: str(c.certificate_details),
    faqs: readFaqs(c.faqs),
    demoUrl: str(c.demo_url),
    successMessage: str(c.success_message),
    inclusions: readInclusions(c.inclusions),
    registrationMode: c.registration_mode === "interest" ? "interest" : "demo",
    ctaLabel: str(c.cta_label),
    highlightBadge: str(c.highlight_badge),
  };
}
