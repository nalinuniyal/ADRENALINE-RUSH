import { z } from "zod";
import { STANDARD_KEYS, type FieldType } from "@/lib/forms/registration";

/** Same rule as the courses/course_categories slug CHECK constraints. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Same rule as the course_registration_fields key CHECK constraint. */
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export const COURSE_STATUSES = ["draft", "published", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export const DELIVERY_MODE_VALUES = ["online", "in_person", "hybrid", "self_paced", "customized"] as const;
export const FIELD_TYPE_VALUES = [
  "text",
  "email",
  "phone",
  "number",
  "select",
  "multiselect",
  "radio",
  "checkbox",
  "date",
  "textarea",
  "consent",
] as const satisfies readonly FieldType[];
/** Field types whose answers are chosen from a list of options. */
export const OPTION_FIELD_TYPES: readonly FieldType[] = ["select", "multiselect", "radio"];

export function toSlug(input: string, max = 80): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** "Years of experience?" → "years_of_experience"; always satisfies FIELD_KEY_RE (or returns ""). */
export function toFieldKey(label: string): string {
  let key = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return "";
  if (!/^[a-z]/.test(key)) key = `q_${key}`;
  return key.slice(0, 40).replace(/_+$/g, "");
}

/** Picks "base", "base_2", "base_3"… avoiding taken and reserved keys. */
export function uniqueFieldKey(base: string, taken: Iterable<string>): string {
  const used = new Set<string>([...taken, ...STANDARD_KEYS]);
  const root = base || "field";
  if (!used.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`;
    const candidate = `${root.slice(0, 40 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root.slice(0, 30)}_${Date.now().toString(36).slice(-8)}`;
}

/** Splits a textarea into trimmed, non-empty lines. */
export function splitLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Picks the next free "<slug>-copy", "<slug>-copy-2"… within the 80-char limit. */
export function nextCopySlug(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; n < 1000; n++) {
    const suffix = n === 1 ? "-copy" : `-copy-${n}`;
    const candidate = `${slug.slice(0, 80 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${slug.slice(0, 60).replace(/-+$/g, "")}-copy-${Date.now().toString(36)}`;
}

// -----------------------------------------------------------------------------
// Building blocks. Form inputs are strings; outputs are DB-ready values.
// -----------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en-US")} characters`)
    .transform((v) => (v === "" ? null : v));

const optionalMoney = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{1,10}(\.\d{1,2})?$/.test(v), "Enter an amount like 4999 or 4999.50")
  .transform((v) => (v === "" ? null : Number(v)));

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), "Enter a valid date")
  .transform((v) => (v === "" ? null : v));

const httpsUrl = (message: string, pattern: RegExp) =>
  z
    .string()
    .trim()
    .max(500, "Keep the link under 500 characters")
    .refine((v) => v === "" || (pattern.test(v) && URL.canParse(v)), message)
    .transform((v) => (v === "" ? null : v));

/** Built-in covers shipped with the site (public/covers). */
export const LOCAL_COVER_PATTERN = /^\/covers\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(svg|png|jpe?g|webp)$/;

/** A course cover is a full https link or one of the site's own /covers/... images. */
export function isCoverImageUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (LOCAL_COVER_PATTERN.test(v) && !v.includes("..")) return true;
  return /^https:\/\/\S+$/i.test(v) && URL.canParse(v);
}

export const slugField = z
  .string()
  .trim()
  .min(1, "Enter a slug")
  .max(80, "Keep the slug under 80 characters")
  .regex(SLUG_RE, "Use lowercase letters, numbers and single hyphens, e.g. salesforce-admin");

export const faqRowSchema = z.object({
  q: z.string().trim().max(300, "Keep the question under 300 characters"),
  a: z.string().trim().max(3000, "Keep the answer under 3,000 characters"),
});

export const MAX_FAQS = 30;
export const MAX_OUTCOMES = 30;
export const MAX_INCLUSIONS = 12;

/** Icons a "What's included" item can use (Lucide names, kebab-case). Rendered by components/public/inclusion-icon. */
export const INCLUSION_ICONS = [
  { value: "check", label: "Check mark" },
  { value: "mic", label: "Microphone (interviews)" },
  { value: "messages-square", label: "Conversation" },
  { value: "briefcase", label: "Briefcase (jobs)" },
  { value: "handshake", label: "Handshake (placement)" },
  { value: "users", label: "People" },
  { value: "presentation", label: "Presentation" },
  { value: "hammer", label: "Hammer (hands-on)" },
  { value: "wrench", label: "Wrench" },
  { value: "code", label: "Code" },
  { value: "life-buoy", label: "Lifebuoy (support)" },
  { value: "headphones", label: "Headset (support)" },
  { value: "graduation-cap", label: "Graduation cap" },
  { value: "award", label: "Award" },
  { value: "badge-check", label: "Verified badge" },
  { value: "book-open", label: "Book" },
  { value: "file-text", label: "Document" },
  { value: "video", label: "Video" },
  { value: "calendar", label: "Calendar" },
  { value: "clock", label: "Clock" },
  { value: "rocket", label: "Rocket" },
  { value: "target", label: "Target" },
  { value: "trophy", label: "Trophy" },
  { value: "sparkles", label: "Sparkles" },
  { value: "shield-check", label: "Shield" },
] as const;
export type InclusionIcon = (typeof INCLUSION_ICONS)[number]["value"];
export const INCLUSION_ICON_VALUES = INCLUSION_ICONS.map((i) => i.value) as [InclusionIcon, ...InclusionIcon[]];

export function isInclusionIcon(v: unknown): v is InclusionIcon {
  return typeof v === "string" && (INCLUSION_ICON_VALUES as readonly string[]).includes(v);
}

export type InclusionRow = { title: string; description: string; icon: InclusionIcon | "" };

/** One-click starter list for the course editor (editable before saving). */
export const SUGGESTED_INCLUSIONS: readonly InclusionRow[] = [
  { title: "Interview practice", description: "Mock interviews with feedback on real questions for this role.", icon: "mic" },
  { title: "Interview & placement support", description: "Resume and LinkedIn review, interview preparation and guidance while you apply.", icon: "handshake" },
  { title: "One-to-one discussions", description: "Personal sessions with the trainer to clear doubts and plan your path.", icon: "messages-square" },
  { title: "Real-life hands-on projects", description: "Build and configure real scenarios, not just slides.", icon: "hammer" },
  { title: "Post-course development support", description: "Help with questions from your job or project after the course ends.", icon: "life-buoy" },
];

/** Adds the suggested items whose titles are not already in the list, without exceeding the maximum. */
export function mergeSuggestedInclusions(current: readonly InclusionRow[]): InclusionRow[] {
  const titles = new Set(current.map((r) => r.title.trim().toLowerCase()));
  const additions = SUGGESTED_INCLUSIONS.filter((s) => !titles.has(s.title.toLowerCase())).map((s) => ({ ...s }));
  return [...current, ...additions].slice(0, Math.max(MAX_INCLUSIONS, current.length));
}

export const inclusionRowSchema = z.object({
  title: z.string().trim().max(80, "Keep the title under 80 characters"),
  description: z.string().trim().max(300, "Keep the description under 300 characters"),
  icon: z.union([z.enum(INCLUSION_ICON_VALUES), z.literal("")], { message: "Choose an icon from the list" }),
});

export const REGISTRATION_MODES = ["demo", "interest"] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export const courseSchema = z
  .object({
    title: z.string().trim().min(3, "Enter a course title (at least 3 characters)").max(140, "Keep the title under 140 characters"),
    slug: slugField,
    categoryId: z
      .string()
      .trim()
      .refine((v) => v === "" || z.uuid().safeParse(v).success, "Choose a category")
      .transform((v) => (v === "" ? null : v)),
    shortDescription: optionalText(300),
    description: optionalText(20000),
    whoIsItFor: optionalText(4000),
    coverImageUrl: z
      .string()
      .trim()
      .max(500, "Keep the link under 500 characters")
      .refine((v) => v === "" || isCoverImageUrl(v), "Use a full image link starting with https:// or a built-in cover such as /covers/mcp.svg")
      .transform((v) => (v === "" ? null : v)),
    instructorName: optionalText(120),
    level: optionalText(40),
    prerequisites: optionalText(4000),
    learningOutcomes: z
      .string()
      .max(20000, "Too much text")
      .superRefine((text, ctx) => {
        const lines = splitLines(text);
        if (lines.length > MAX_OUTCOMES) ctx.addIssue({ code: "custom", message: `List at most ${MAX_OUTCOMES} outcomes` });
        if (lines.some((l) => l.length > 300)) ctx.addIssue({ code: "custom", message: "Keep each outcome under 300 characters" });
      })
      .transform(splitLines),
    durationText: optionalText(80),
    deliveryMode: z.enum(DELIVERY_MODE_VALUES, { message: "Choose a delivery mode" }),
    listPrice: optionalMoney,
    discountedPrice: optionalMoney,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code, e.g. INR"),
    showPrice: z.boolean(),
    capacity: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{1,6}$/.test(v) && Number(v) > 0), "Enter a whole number greater than 0")
      .transform((v) => (v === "" ? null : Number(v))),
    enrollmentOpensOn: optionalDate,
    enrollmentClosesOn: optionalDate,
    certificateDetails: optionalText(2000),
    faqs: z
      .array(faqRowSchema)
      .max(MAX_FAQS, `Add at most ${MAX_FAQS} FAQs`)
      .superRefine((rows, ctx) => {
        rows.forEach((r, i) => {
          if (r.q && !r.a) ctx.addIssue({ code: "custom", path: [i, "a"], message: "Add an answer or remove this FAQ" });
          if (!r.q && r.a) ctx.addIssue({ code: "custom", path: [i, "q"], message: "Add a question or remove this FAQ" });
        });
      })
      .transform((rows) => rows.filter((r) => r.q && r.a).map((r) => ({ q: r.q, a: r.a }))),
    demoUrl: httpsUrl("Use a full link starting with https://", /^https?:\/\/\S+$/i),
    successMessage: optionalText(1000),
    inclusions: z
      .array(inclusionRowSchema)
      .max(MAX_INCLUSIONS, `Add at most ${MAX_INCLUSIONS} items`)
      .superRefine((rows, ctx) => {
        rows.forEach((r, i) => {
          if (!r.title && r.description) ctx.addIssue({ code: "custom", path: [i, "title"], message: "Add a title or remove this item" });
        });
      })
      .transform((rows) =>
        rows
          .filter((r) => r.title)
          .map((r) => ({ title: r.title, ...(r.description ? { description: r.description } : {}), ...(r.icon ? { icon: r.icon } : {}) })),
      ),
    registrationMode: z.enum(REGISTRATION_MODES, { message: "Choose how people register" }),
    ctaLabel: optionalText(40),
    highlightBadge: optionalText(80),
  })
  .superRefine((v, ctx) => {
    if (v.discountedPrice !== null && v.listPrice === null) {
      ctx.addIssue({ code: "custom", path: ["discountedPrice"], message: "Set a list price before adding a discounted price" });
    }
    if (v.discountedPrice !== null && v.listPrice !== null && v.discountedPrice > v.listPrice) {
      ctx.addIssue({ code: "custom", path: ["discountedPrice"], message: "The discounted price cannot be higher than the list price" });
    }
    if (v.enrollmentOpensOn && v.enrollmentClosesOn && v.enrollmentClosesOn < v.enrollmentOpensOn) {
      ctx.addIssue({ code: "custom", path: ["enrollmentClosesOn"], message: "Registration cannot close before it opens" });
    }
  });

export type CourseFormInput = z.input<typeof courseSchema>;
export type CourseFormOutput = z.output<typeof courseSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a category name (at least 2 characters)").max(80, "Keep the name under 80 characters"),
  slug: slugField,
  description: optionalText(1000),
  position: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,5}$/.test(v) && Number(v) <= 10000), "Enter a whole number from 0 to 10000")
    .transform((v) => (v === "" ? 0 : Number(v))),
});

export type CategoryFormInput = z.input<typeof categorySchema>;

export const curriculumSchema = z.object({ text: z.string().max(100_000, "The curriculum is too long") });

export const registrationFieldSchema = z
  .object({
    label: z.string().trim().min(1, "Enter a label").max(200, "Keep the label under 200 characters"),
    key: z.string().trim().regex(FIELD_KEY_RE, "Start with a letter; use lowercase letters, numbers and underscores (max 40)"),
    type: z.enum(FIELD_TYPE_VALUES, { message: "Choose a field type" }),
    required: z.boolean(),
    options: z.string().max(20000, "Too many options"),
    helpText: optionalText(500),
    placeholder: optionalText(200),
  })
  .transform((v, ctx) => {
    const isOptionType = OPTION_FIELD_TYPES.includes(v.type);
    const options = isOptionType ? [...new Set(splitLines(v.options))] : [];
    if (isOptionType && options.length === 0) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one option, one per line" });
    }
    if (options.length > 50) ctx.addIssue({ code: "custom", path: ["options"], message: "Use at most 50 options" });
    if (options.some((o) => o.length > 200)) ctx.addIssue({ code: "custom", path: ["options"], message: "Keep each option under 200 characters" });
    // A consent box must always be ticked, so it is always required.
    return { ...v, options, required: v.type === "consent" ? true : v.required };
  });

export type RegistrationFieldInput = z.input<typeof registrationFieldSchema>;
export type RegistrationFieldOutput = z.output<typeof registrationFieldSchema>;

export function isReservedFieldKey(key: string): boolean {
  return (STANDARD_KEYS as readonly string[]).includes(key);
}

/**
 * Rules the public registration flow depends on (submit_registration needs a
 * name and an email or phone; privacy consent is mandatory).
 */
export type FieldState = { key: string; required: boolean; is_active: boolean };

export function formIntegrityIssues(fields: readonly FieldState[]): string[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const on = (key: string) => {
    const f = byKey.get(key);
    return Boolean(f && f.is_active && f.required);
  };
  const issues: string[] = [];
  if (!on("privacy_consent")) issues.push("The privacy consent field must stay active and required.");
  if (!on("full_name")) issues.push("The full name field must stay active and required.");
  if (!on("email") && !on("phone")) issues.push("Keep either the email or the phone field active and required, so you can contact registrants.");
  return issues;
}

/** Returns the first rule a proposed change would newly break, or null. */
export function integrityErrorForChange(before: readonly FieldState[], after: readonly FieldState[]): string | null {
  const existing = new Set(formIntegrityIssues(before));
  return formIntegrityIssues(after).find((i) => !existing.has(i)) ?? null;
}

export const courseListFilterSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  status: z.enum(["all", ...COURSE_STATUSES]).catch("all"),
  category: z.union([z.uuid(), z.literal("none"), z.literal("")]).catch(""),
  page: z.coerce.number().int().min(1).max(10000).catch(1),
});

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
