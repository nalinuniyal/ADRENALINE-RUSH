import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Normalisation (mirrors public.normalize_email / public.phone_match_key)     */
/* -------------------------------------------------------------------------- */

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "" ? null : v;
}

/** Last 10 digits: "+91 98765 43210", "09876543210" and "9876543210" all match. */
export function phoneMatchKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  const key = digits.slice(-10);
  return key === "" ? null : key;
}

/* -------------------------------------------------------------------------- */
/* Shared field helpers                                                        */
/* -------------------------------------------------------------------------- */

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL_MESSAGE = "Enter a valid email address";
const PHONE_MESSAGE = "Enter a phone number with country code, e.g. +91 98765 43210";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || z.email().safeParse(v).success, EMAIL_MESSAGE);

const optionalPhone = optionalText(32).refine((v) => v === null || PHONE_RE.test(v), PHONE_MESSAGE);

const optionalYears = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 60) {
      ctx.addIssue({ code: "custom", message: "Enter years between 0 and 60" });
      return z.NEVER;
    }
    return Math.round(n * 10) / 10;
  });

const optionalId = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.guid().safeParse(v).success, "Choose a valid option");

/* -------------------------------------------------------------------------- */
/* Candidate details (create + edit)                                           */
/* -------------------------------------------------------------------------- */

const candidateDetailsShape = {
  fullName: z.string().trim().min(1, "Enter the candidate's name").max(160, "Use 160 characters or fewer"),
  email: optionalEmail,
  phone: optionalPhone,
  company: optionalText(160),
  jobTitle: optionalText(160),
  city: optionalText(100),
  country: optionalText(100),
  totalExperienceYears: optionalYears,
  relevantExperienceYears: optionalYears,
  skills: optionalText(2000),
  interests: optionalText(2000),
  learningObjectives: optionalText(4000),
  preferredSchedule: optionalText(200),
  preferredDeliveryMode: optionalText(60),
  employmentStatus: optionalText(60),
  heardAbout: optionalText(200),
  source: optionalText(60),
  utmSource: optionalText(120),
  utmMedium: optionalText(120),
  utmCampaign: optionalText(120),
  marketingConsent: z.boolean().default(false),
  privacyConsent: z.boolean().default(false),
  doNotContact: z.boolean().default(false),
};

const needsContact = <T extends { email: string | null; phone: string | null }>(v: T) => v.email !== null || v.phone !== null;
const contactIssue = { message: "Enter an email address or a phone number", path: ["email"] };

export const candidateDetailsSchema = z.object(candidateDetailsShape).refine(needsContact, contactIssue);

export const candidateCreateSchema = z
  .object({
    ...candidateDetailsShape,
    leadStatusId: optionalId,
    ownerId: optionalId,
    courseId: optionalId,
  })
  .refine(needsContact, contactIssue);

export type CandidateDetailsInput = z.input<typeof candidateDetailsSchema>;
export type CandidateDetails = z.output<typeof candidateDetailsSchema>;
export type CandidateCreateInput = z.input<typeof candidateCreateSchema>;
export type CandidateCreate = z.output<typeof candidateCreateSchema>;

/** Maps validated form values to candidates columns (consent handled by the caller). */
export function candidateColumns(v: CandidateDetails) {
  return {
    full_name: v.fullName,
    email: v.email,
    phone: v.phone,
    company: v.company,
    job_title: v.jobTitle,
    city: v.city,
    country: v.country,
    total_experience_years: v.totalExperienceYears,
    relevant_experience_years: v.relevantExperienceYears,
    skills: v.skills,
    interests: v.interests,
    learning_objectives: v.learningObjectives,
    preferred_schedule: v.preferredSchedule,
    preferred_delivery_mode: v.preferredDeliveryMode,
    employment_status: v.employmentStatus,
    heard_about: v.heardAbout,
    source: v.source,
    utm_source: v.utmSource,
    utm_medium: v.utmMedium,
    utm_campaign: v.utmCampaign,
    marketing_consent: v.marketingConsent,
    do_not_contact: v.doNotContact,
  };
}

/* -------------------------------------------------------------------------- */
/* Notes, follow-ups, status, owner                                            */
/* -------------------------------------------------------------------------- */

export const noteSchema = z.object({
  candidateId: z.guid(),
  body: z.string().trim().min(1, "Write a note first").max(5000, "Notes are limited to 5000 characters"),
});

export const followUpSchema = z.object({
  candidateId: z.guid(),
  title: z.string().trim().min(1, "Describe the follow-up").max(200, "Use 200 characters or fewer"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time"),
  assignedTo: optionalId,
  notes: optionalText(4000),
});

export const taskStatusSchema = z.object({
  taskId: z.guid(),
  status: z.enum(["open", "done", "cancelled"]),
});

export const statusChangeSchema = z.object({ candidateId: z.guid(), leadStatusId: z.guid() });
export const ownerChangeSchema = z.object({ candidateId: z.guid(), ownerId: optionalId });

/* -------------------------------------------------------------------------- */
/* Lead status configuration                                                   */
/* -------------------------------------------------------------------------- */

export const LEAD_STATUS_COLORS = ["neutral", "brand", "success", "warning", "danger", "violet", "teal"] as const;
export type LeadStatusColor = (typeof LEAD_STATUS_COLORS)[number];

export const LEAD_STATUS_COLOR_LABELS: Record<LeadStatusColor, string> = {
  neutral: "Grey",
  brand: "Blue",
  success: "Green",
  warning: "Orange",
  danger: "Red",
  violet: "Violet",
  teal: "Teal",
};

export function isLeadStatusColor(v: string): v is LeadStatusColor {
  return (LEAD_STATUS_COLORS as readonly string[]).includes(v);
}

export const leadStatusSchema = z
  .object({
    label: z.string().trim().min(1, "Enter a label").max(60, "Use 60 characters or fewer"),
    color: z.enum(LEAD_STATUS_COLORS, { message: "Choose a colour" }),
    isClosed: z.boolean().default(false),
    isWon: z.boolean().default(false),
  })
  .refine((v) => !v.isWon || v.isClosed, { message: "A won status must also be closed", path: ["isWon"] });

export const leadStatusUpdateSchema = z.object({ id: z.guid() }).and(leadStatusSchema);

/** Database key for a new status label, e.g. "Call back later!" -> "call_back_later". */
export function leadStatusKey(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "");
  return (base || "status").slice(0, 40).replace(/_+$/, "");
}

/** Makes `key` unique among `taken` by appending _2, _3, ... */
export function uniqueKey(key: string, taken: readonly string[]): string {
  if (!taken.includes(key)) return key;
  for (let i = 2; ; i++) {
    const suffix = `_${i}`;
    const candidate = key.slice(0, 40 - suffix.length) + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

/* -------------------------------------------------------------------------- */
/* List filters (from searchParams)                                            */
/* -------------------------------------------------------------------------- */

export const CANDIDATE_SORTS = ["newest", "oldest", "name", "activity"] as const;
export type CandidateSort = (typeof CANDIDATE_SORTS)[number];
export const CANDIDATE_SORT_LABELS: Record<CandidateSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name (A–Z)",
  activity: "Recent activity",
};

export const PAGE_SIZE = 25;

export type CandidateFilters = {
  q: string | null;
  status: string | null;
  course: string | null;
  /** "unassigned", "me" or a user id */
  owner: string | null;
  source: string | null;
  followup: "overdue" | null;
  sort: CandidateSort;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isGuid = (v: string) => z.guid().safeParse(v).success;

/** Lenient: anything invalid is ignored rather than failing the page. */
export function parseCandidateFilters(params: RawParams): CandidateFilters {
  const text = (k: string, max: number) => {
    const v = first(params[k])?.trim().replace(/\s+/g, " ") ?? "";
    return v ? v.slice(0, max) : null;
  };
  const id = (k: string) => {
    const v = first(params[k]);
    return v && isGuid(v) ? v : null;
  };
  const ownerRaw = first(params.owner);
  const sortRaw = first(params.sort);
  const pageRaw = Number(first(params.page));
  return {
    q: text("q", 100),
    status: id("status"),
    course: id("course"),
    owner: ownerRaw === "unassigned" || ownerRaw === "me" || (ownerRaw && isGuid(ownerRaw)) ? ownerRaw : null,
    source: text("source", 120),
    followup: first(params.followup) === "overdue" ? "overdue" : null,
    sort: (CANDIDATE_SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as CandidateSort) : "newest",
    page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1,
  };
}

/** Builds a query string for the list, dropping defaults. */
export function candidateFiltersQuery(filters: CandidateFilters, patch: Partial<CandidateFilters> = {}): string {
  const f = { ...filters, ...patch };
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.status) sp.set("status", f.status);
  if (f.course) sp.set("course", f.course);
  if (f.owner) sp.set("owner", f.owner);
  if (f.source) sp.set("source", f.source);
  if (f.followup) sp.set("followup", f.followup);
  if (f.sort !== "newest") sp.set("sort", f.sort);
  if (f.page > 1) sp.set("page", String(f.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: CandidateFilters): boolean {
  return Boolean(f.q || f.status || f.course || f.owner || f.source || f.followup);
}

/** Search across name, email, phone and company; digit-only input also matches the phone key. */
export function searchConditions(q: string): string[] {
  const clean = q.replace(/[(),"\\*%:]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const conds = ["full_name", "email", "phone", "company"].map((col) => `${col}.ilike."%${clean}%"`);
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 4 && /^[\d\s+()-]+$/.test(clean)) conds.push(`phone_key.like."%${digits.slice(-10)}%"`);
  return conds;
}

export function sourceConditions(source: string): string[] {
  const clean = source.replace(/[(),"\\*%:]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return [`source.ilike."${clean}"`, `utm_source.ilike."${clean}"`];
}

/**
 * Combines search and source groups into ONE or= expression (each group is
 * OR'd internally, groups are AND'd), or null when neither is set.
 */
export function combinedOrFilter(groups: string[][]): string | null {
  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length === 0) return null;
  if (nonEmpty.length === 1) return nonEmpty[0].join(",");
  return `and(${nonEmpty.map((g) => `or(${g.join(",")})`).join(",")})`;
}

/* -------------------------------------------------------------------------- */
/* CSV import                                                                  */
/* -------------------------------------------------------------------------- */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
/** next.config.ts raises the Server Action body limit to 3 MB; leave room for overhead. */
export const MAX_IMPORT_PAYLOAD_BYTES = 2.8 * 1024 * 1024;

export const IMPORT_FIELDS = [
  { key: "full_name", label: "Full name", aliases: ["name", "full name", "fullname", "candidate", "candidate name", "student name"] },
  { key: "email", label: "Email", aliases: ["email address", "e-mail", "mail", "email id"] },
  { key: "phone", label: "Phone", aliases: ["phone number", "mobile", "mobile number", "contact", "contact number", "whatsapp", "phone no"] },
  { key: "company", label: "Company", aliases: ["organisation", "organization", "employer", "current company"] },
  { key: "job_title", label: "Job title", aliases: ["title", "designation", "role", "position"] },
  { key: "city", label: "City", aliases: ["location", "town"] },
  { key: "country", label: "Country", aliases: [] },
  { key: "source", label: "Source", aliases: ["lead source", "channel"] },
  { key: "utm_source", label: "UTM source", aliases: ["utm source", "utmsource"] },
  { key: "utm_medium", label: "UTM medium", aliases: ["utm medium", "utmmedium"] },
  { key: "utm_campaign", label: "UTM campaign", aliases: ["utm campaign", "utmcampaign", "campaign"] },
  { key: "notes", label: "Notes", aliases: ["note", "comments", "comment", "remarks"] },
  { key: "lead_status", label: "Lead status (key or label)", aliases: ["status", "lead status", "stage"] },
  { key: "course_slug", label: "Course (slug)", aliases: ["course", "course slug", "program", "programme"] },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ImportRow = Partial<Record<ImportFieldKey, string>>;
/** column index -> field (or null to skip) */
export type ColumnMapping = (ImportFieldKey | null)[];

const simplify = (s: string) => s.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

/** Guesses a field for each CSV header; each field is used at most once. */
export function autoMapColumns(headers: readonly string[]): ColumnMapping {
  const used = new Set<ImportFieldKey>();
  return headers.map((h) => {
    const s = simplify(h);
    const match = IMPORT_FIELDS.find(
      (f) => !used.has(f.key) && (simplify(f.key) === s || simplify(f.label) === s || (f.aliases as readonly string[]).some((a) => simplify(a) === s)),
    );
    if (!match) return null;
    used.add(match.key);
    return match.key;
  });
}

const importLimits: Record<ImportFieldKey, number> = {
  full_name: 160,
  email: 254,
  phone: 32,
  company: 160,
  job_title: 160,
  city: 100,
  country: 100,
  source: 60,
  utm_source: 120,
  utm_medium: 120,
  utm_campaign: 120,
  notes: 5000,
  lead_status: 60,
  course_slug: 80,
};

export type ImportPreviewRow = {
  /** 1-based data row number (header excluded) */
  row: number;
  values: ImportRow;
  errors: string[];
  /** Row number of an earlier row with the same email or phone */
  duplicateOfRow: number | null;
  /** Same email/phone as a candidate already in the CRM */
  existing: boolean;
};

export type ImportContext = {
  statuses: readonly { key: string; label: string }[];
  courseSlugs: readonly string[];
  existingEmails?: ReadonlySet<string>;
  existingPhoneKeys?: ReadonlySet<string>;
};

export function applyMapping(row: readonly string[], mapping: ColumnMapping): ImportRow {
  const out: ImportRow = {};
  mapping.forEach((field, i) => {
    if (!field) return;
    const v = (row[i] ?? "").trim();
    if (v !== "") out[field] = out[field] ? `${out[field]} ${v}` : v;
  });
  return out;
}

export function validateImportRow(values: ImportRow, ctx: Omit<ImportContext, "existingEmails" | "existingPhoneKeys">): string[] {
  const errors: string[] = [];
  if (!values.full_name) errors.push("Name is missing");
  if (!values.email && !values.phone) errors.push("Email or phone is required");
  if (values.email && !z.email().safeParse(values.email.toLowerCase()).success) errors.push("Email address is not valid");
  if (values.phone && !phoneMatchKey(values.phone)) errors.push("Phone number has no digits");
  for (const f of IMPORT_FIELDS) {
    const v = values[f.key];
    if (v && v.length > importLimits[f.key]) errors.push(`${f.label} is longer than ${importLimits[f.key]} characters`);
  }
  if (values.lead_status) {
    const s = values.lead_status.toLowerCase();
    if (!ctx.statuses.some((st) => st.key === s || st.label.toLowerCase() === s)) errors.push(`Unknown lead status “${values.lead_status}”`);
  }
  if (values.course_slug && !ctx.courseSlugs.includes(values.course_slug.toLowerCase())) {
    errors.push(`Unknown course “${values.course_slug}”`);
  }
  return errors;
}

/** Validates every row and flags duplicates within the file and against existing candidates. */
export function buildImportPreview(rows: readonly (readonly string[])[], mapping: ColumnMapping, ctx: ImportContext): ImportPreviewRow[] {
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  return rows.map((raw, i) => {
    const row = i + 1;
    const values = applyMapping(raw, mapping);
    const errors = validateImportRow(values, ctx);
    const email = normalizeEmail(values.email);
    const phone = phoneMatchKey(values.phone);
    let duplicateOfRow: number | null = null;
    let existing = false;
    if (errors.length === 0) {
      existing = Boolean((email && ctx.existingEmails?.has(email)) || (phone && ctx.existingPhoneKeys?.has(phone)));
      duplicateOfRow = (email ? seenEmail.get(email) : undefined) ?? (phone ? seenPhone.get(phone) : undefined) ?? null;
      if (email && !seenEmail.has(email)) seenEmail.set(email, row);
      if (phone && !seenPhone.has(phone)) seenPhone.set(phone, row);
    }
    return { row, values, errors, duplicateOfRow, existing };
  });
}

export function summarizePreview(preview: readonly ImportPreviewRow[]) {
  let ready = 0;
  let invalid = 0;
  let duplicates = 0;
  for (const p of preview) {
    if (p.errors.length) invalid++;
    else if (p.existing || p.duplicateOfRow !== null) duplicates++;
    else ready++;
  }
  return { ready, invalid, duplicates, total: preview.length };
}

const importRowValue = (key: ImportFieldKey) => z.string().max(importLimits[key]).optional();

export const importRowSchema = z.object(
  Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, importRowValue(f.key)])) as Record<ImportFieldKey, ReturnType<typeof importRowValue>>,
);

export const importCommitSchema = z.object({
  rows: z.array(importRowSchema).min(1, "The file has no rows to import").max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`),
  ownerId: optionalId,
  fileName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
});

export const importKeysSchema = z.object({
  emails: z.array(z.string().max(254)).max(MAX_IMPORT_ROWS),
  phoneKeys: z.array(z.string().max(32)).max(MAX_IMPORT_ROWS),
});
