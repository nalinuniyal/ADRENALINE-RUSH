/**
 * Template variables: the {{name}} placeholders admins can use in subjects,
 * text and custom HTML. Pure functions (used by the server and by the
 * editor's live preview).
 */

export type EmailAudience = "candidate" | "team";

export type VariableDef = { name: string; label: string; example: string; teamOnly?: boolean };

export const EMAIL_VARIABLES: readonly VariableDef[] = [
  { name: "candidate_name", label: "Candidate's full name", example: "Priya Sharma" },
  { name: "first_name", label: "Candidate's first name", example: "Priya" },
  { name: "course_title", label: "Course title", example: "Salesforce Marketing Cloud" },
  { name: "course_url", label: "Public course page link", example: "https://example.com/courses/marketing-cloud" },
  { name: "demo_url", label: "Demo link (the course's demo link, or its page)", example: "https://example.com/courses/marketing-cloud" },
  { name: "business_name", label: "Your business name", example: "Adrenaline Rush" },
  { name: "candidate_email", label: "Candidate's email", example: "priya@example.com" },
  { name: "candidate_phone", label: "Candidate's phone", example: "+91 98765 43210" },
  { name: "registration_answers", label: "Everything the candidate filled in (team emails only)", example: "City: Pune\nCurrent company: Example Ltd\nTotal experience (years): 4", teamOnly: true },
  { name: "candidate_admin_url", label: "Link to the candidate in the dashboard (team emails only)", example: "https://example.com/admin/candidates/…", teamOnly: true },
  // Filled only for the team invitation email (Settings → Team).
  { name: "invitee_name", label: "Invited person's name (team invitation only)", example: "Rahul", teamOnly: true },
  { name: "invite_role", label: "Role they are invited as (team invitation only)", example: "Staff / Counselor", teamOnly: true },
  { name: "inviter_name", label: "Who sent the invitation (team invitation only)", example: "Asha", teamOnly: true },
  { name: "invite_url", label: "Accept-invitation link (team invitation only)", example: "https://example.com/invite/…", teamOnly: true },
  { name: "invite_expires", label: "When the invitation link expires (team invitation only)", example: "22 Oct 2026", teamOnly: true },
];

export type EmailVariables = Record<string, string>;

const VAR_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/**
 * Replaces {{variables}}. Unknown variables become empty text so a typo never
 * leaks braces to recipients. In "html" mode values are HTML-escaped and line
 * breaks become <br>.
 */
export function substitute(template: string, vars: EmailVariables, mode: "text" | "html" = "text"): string {
  return template.replace(VAR_RE, (_m, name: string) => {
    const value = vars[name.toLowerCase()] ?? "";
    return mode === "html" ? escapeHtml(value).replace(/\r?\n/g, "<br>") : value;
  });
}

/** Variables used in a template that the catalogue does not know about (for editor warnings). */
export function unknownVariables(...texts: (string | null | undefined)[]): string[] {
  const known = new Set(EMAIL_VARIABLES.map((v) => v.name));
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of (t ?? "").matchAll(VAR_RE)) {
      const n = m[1].toLowerCase();
      if (!known.has(n)) found.add(n);
    }
  }
  return [...found];
}

/** Example values for previews and test emails. */
export function sampleVariables(audience: EmailAudience, overrides: Partial<EmailVariables> = {}): EmailVariables {
  const vars: EmailVariables = {};
  for (const v of EMAIL_VARIABLES) {
    if (v.teamOnly && audience === "candidate") vars[v.name] = "";
    else vars[v.name] = v.example;
  }
  return { ...vars, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) } as EmailVariables;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

const STANDARD_LABELS: Record<string, string> = {
  city: "City",
  country: "Country",
  company: "Current company",
  job_title: "Current job title",
  total_experience_years: "Total experience (years)",
  relevant_experience_years: "Relevant experience (years)",
  skills: "Current skills",
  interests: "Interests",
  learning_objectives: "Goals",
  preferred_schedule: "Preferred schedule",
  preferred_delivery_mode: "Preferred delivery",
  employment_status: "Employment status",
  heard_about: "Heard about us via",
};

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(displayValue).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  return String(v).trim();
}

/** "Label: value" lines from the candidate's standard details and the registration's custom answers. */
export function formatRegistrationAnswers(candidate: Record<string, unknown>, answers: unknown): string {
  const lines: string[] = [];
  for (const [key, label] of Object.entries(STANDARD_LABELS)) {
    const v = displayValue(candidate[key]);
    if (v) lines.push(`${label}: ${v}`);
  }
  if (answers && typeof answers === "object" && !Array.isArray(answers)) {
    for (const [key, raw] of Object.entries(answers as Record<string, unknown>)) {
      const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { label?: unknown; value?: unknown }) : { value: raw };
      const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : key;
      const v = displayValue(entry.value);
      if (v) lines.push(`${label}: ${v}`);
    }
  }
  return lines.map((l) => (l.length > 600 ? `${l.slice(0, 600)}…` : l)).join("\n");
}

export type VariableSource = {
  siteUrl: string;
  businessName: string;
  candidate: { id: string; full_name: string; email: string | null; phone: string | null } & Record<string, unknown>;
  course: { title: string; slug: string; demo_url: string | null } | null;
  answers?: unknown;
};

/** Real values for one registration. Team-only variables are blank for candidate emails. */
export function buildVariables(src: VariableSource, audience: EmailAudience): EmailVariables {
  const site = src.siteUrl.replace(/\/+$/, "");
  const courseUrl = src.course ? `${site}/courses/${encodeURIComponent(src.course.slug)}` : site;
  const team = audience === "team";
  return {
    candidate_name: src.candidate.full_name,
    first_name: firstName(src.candidate.full_name),
    course_title: src.course?.title ?? "",
    course_url: courseUrl,
    demo_url: src.course?.demo_url || courseUrl,
    business_name: src.businessName,
    candidate_email: src.candidate.email ?? "",
    candidate_phone: src.candidate.phone ?? "",
    registration_answers: team ? formatRegistrationAnswers(src.candidate, src.answers) : "",
    candidate_admin_url: team ? `${site}/admin/candidates/${src.candidate.id}` : "",
  };
}
