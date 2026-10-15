/** Resource catalogue shared by the admin screens, the public page and validation. */

export const RESOURCE_TYPES = [
  "demo_video",
  "recorded_demo",
  "demo_booking",
  "sample_class",
  "curriculum",
  "presentation",
  "project_example",
  "documentation",
  "github_repo",
  "assignment",
  "recording",
  "link",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  demo_video: "Demo video",
  recorded_demo: "Recorded demo session",
  demo_booking: "Live demo booking",
  sample_class: "Sample class",
  curriculum: "Curriculum document",
  presentation: "Presentation",
  project_example: "Project example",
  documentation: "Documentation link",
  github_repo: "GitHub repository",
  assignment: "Assignment",
  recording: "Class recording",
  link: "Other link",
};

export function isResourceType(v: unknown): v is ResourceType {
  return typeof v === "string" && (RESOURCE_TYPES as readonly string[]).includes(v);
}

export function resourceTypeLabel(v: string): string {
  return isResourceType(v) ? RESOURCE_TYPE_LABELS[v] : "Link";
}

export const VISIBILITIES = ["internal", "shareable"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const SHARE_METHODS = ["copy_message", "copy_link", "whatsapp", "email"] as const;
export type ShareMethod = (typeof SHARE_METHODS)[number];
export type ShareStatus = "copied" | "opened" | "sent" | "failed" | "not_sent";

export const SHARE_METHOD_LABELS: Record<ShareMethod, string> = {
  copy_message: "Message copied",
  copy_link: "Link copied",
  whatsapp: "WhatsApp",
  email: "Email",
};

/** Honest status wording: only an email accepted by the provider is "sent". */
export const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
  copied: "Copied (not confirmed sent)",
  opened: "WhatsApp opened (not confirmed sent)",
  sent: "Sent by email",
  failed: "Email failed",
  not_sent: "Email not sent",
};

export const TEMPLATE_CHANNELS = ["any", "whatsapp", "email"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];
export const TEMPLATE_CHANNEL_LABELS: Record<TemplateChannel, string> = {
  any: "WhatsApp or email",
  whatsapp: "WhatsApp",
  email: "Email",
};

/** True while a resource can be shared (mirrors public.resource_is_shareable). */
export function isShareable(r: { visibility: string; is_active: boolean; expires_on: string | null }, today: string): boolean {
  return r.visibility === "shareable" && r.is_active && (r.expires_on === null || r.expires_on >= today);
}

/** Today's date (YYYY-MM-DD) in the organization's time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
