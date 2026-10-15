/**
 * Share message templates: {{variables}} → text for WhatsApp, copy and email.
 * Pure and isomorphic (the share screen previews with the same code the
 * server uses to send and record).
 */
import { firstName, substitute } from "@/lib/email/variables";

export type ShareVariableDef = { name: string; label: string; example: string };

export const SHARE_VARIABLES: readonly ShareVariableDef[] = [
  { name: "first_name", label: "Candidate's first name (\"there\" when no candidate)", example: "Priya" },
  { name: "candidate_name", label: "Candidate's full name", example: "Priya Sharma" },
  { name: "course_title", label: "Course title", example: "Salesforce Marketing Cloud" },
  { name: "course_url", label: "Public course page link", example: "https://example.com/courses/marketing-cloud" },
  { name: "resource_links", label: "Every selected resource, one per line", example: "• Demo class recording: https://example.com/r/demo-class" },
  { name: "demo_url", label: "Link to the first selected resource", example: "https://example.com/r/demo-class" },
  { name: "business_name", label: "Your business name", example: "Adrenaline Rush" },
  { name: "sender_name", label: "Your name (the person sharing)", example: "Your name" },
];

export type LinkMode = "page" | "direct";

export type ShareResource = { id: string; title: string; slug: string; url: string };

export type ShareCourse = { title: string; slug: string; published: boolean };

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Link sent for a resource: its branded public page, or the original link. */
export function resourceLink(r: ShareResource, siteUrl: string, mode: LinkMode = "page"): string {
  return mode === "direct" ? r.url : `${trimSlash(siteUrl)}/r/${encodeURIComponent(r.slug)}`;
}

export function resourceLinksText(resources: readonly ShareResource[], siteUrl: string, mode: LinkMode = "page"): string {
  return resources.map((r) => `• ${r.title}: ${resourceLink(r, siteUrl, mode)}`).join("\n");
}

/** Text for "Copy link": the bare link for one resource, a bulleted list for several. */
export function linksForCopy(resources: readonly ShareResource[], siteUrl: string, mode: LinkMode = "page"): string {
  return resources.length === 1 ? resourceLink(resources[0], siteUrl, mode) : resourceLinksText(resources, siteUrl, mode);
}

export function courseUrl(course: ShareCourse | null, siteUrl: string): string {
  const site = trimSlash(siteUrl);
  return course?.published ? `${site}/courses/${encodeURIComponent(course.slug)}` : `${site}/courses`;
}

export type ShareVariableSource = {
  siteUrl: string;
  businessName: string;
  senderName: string;
  candidate: { full_name: string } | null;
  course: ShareCourse | null;
  resources: readonly ShareResource[];
  linkMode?: LinkMode;
};

export function buildShareVariables(src: ShareVariableSource): Record<string, string> {
  const mode = src.linkMode ?? "page";
  const name = src.candidate?.full_name.trim() ?? "";
  return {
    first_name: name ? firstName(name) : "there",
    candidate_name: name,
    course_title: src.course?.title ?? "our course",
    course_url: courseUrl(src.course, src.siteUrl),
    resource_links: resourceLinksText(src.resources, src.siteUrl, mode),
    demo_url: src.resources[0] ? resourceLink(src.resources[0], src.siteUrl, mode) : courseUrl(src.course, src.siteUrl),
    business_name: src.businessName,
    sender_name: src.senderName,
  };
}

/** Fills the variables (unknown ones become empty) and tidies blank lines. */
export function renderShareMessage(body: string, vars: Record<string, string>): string {
  return substitute(body, vars, "text")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Variables used in a template that are not in SHARE_VARIABLES (for editor warnings). */
export function unknownShareVariables(...texts: (string | null | undefined)[]): string[] {
  const known = new Set(SHARE_VARIABLES.map((v) => v.name));
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of (t ?? "").matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi)) {
      const n = m[1].toLowerCase();
      if (!known.has(n)) found.add(n);
    }
  }
  return [...found];
}

/** Example values for template previews. */
export function sampleShareVariables(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const v of SHARE_VARIABLES) vars[v.name] = v.example;
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) vars[k] = v;
  return vars;
}

/** WhatsApp links stop working reliably with very long prefilled text. */
export const WHATSAPP_MAX_MESSAGE = 1800;

/** Public page slug: title words plus a random suffix so links are hard to guess. */
export function resourceSlug(title: string, random: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const suffix = random.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "x";
  return base ? `${base}-${suffix}` : `resource-${suffix}`;
}
