/**
 * Permission keys. Must match public.permissions in the database
 * (supabase/migrations/20261014000001_foundation.sql). The database is the
 * source of truth for who has what; this list only drives the UI and
 * server-side guards.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "courses.view",
  "courses.manage",
  "candidates.view_all",
  "candidates.view_assigned",
  "candidates.manage",
  "candidates.import",
  "candidates.export",
  "resources.view",
  "resources.manage",
  "resources.share",
  "batches.view",
  "batches.manage",
  "enrollments.manage",
  "sessions.view",
  "sessions.manage",
  "attendance.record",
  "finance.view",
  "finance.manage",
  "marketing.view",
  "marketing.manage",
  "reports.view",
  "reports.export",
  "settings.manage",
  "members.manage",
  "integrations.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type MemberRole = "owner" | "admin" | "staff" | "instructor";

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** True when the user holds at least one of the required permissions. */
export function hasAny(granted: readonly string[], required: readonly Permission[]): boolean {
  if (required.length === 0) return true;
  return required.some((p) => granted.includes(p));
}

export type NavIcon =
  | "dashboard"
  | "courses"
  | "candidates"
  | "batches"
  | "calendar"
  | "resources"
  | "finance"
  | "marketing"
  | "analytics"
  | "settings";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Any one of these grants access. */
  requires: readonly Permission[];
  /** Short tab label for the navigation bar. */
  short?: string;
  /** Roadmap phase that delivers the module. */
  phase: number;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard", requires: ["dashboard.view"], phase: 7 },
  { href: "/admin/courses", label: "Courses", icon: "courses", requires: ["courses.view"], phase: 2 },
  {
    href: "/admin/candidates",
    label: "Candidates & Students",
    short: "Candidates",
    icon: "candidates",
    requires: ["candidates.view_all", "candidates.view_assigned"],
    phase: 3,
  },
  { href: "/admin/batches", label: "Batches", icon: "batches", requires: ["batches.view"], phase: 5 },
  { href: "/admin/calendar", label: "Calendar & Sessions", short: "Calendar", icon: "calendar", requires: ["sessions.view"], phase: 5 },
  { href: "/admin/resources", label: "Demos & Resources", short: "Demos", icon: "resources", requires: ["resources.view"], phase: 4 },
  { href: "/admin/finance", label: "Payments & Expenses", short: "Finance", icon: "finance", requires: ["finance.view"], phase: 6 },
  { href: "/admin/marketing", label: "Marketing & Emails", short: "Marketing", icon: "marketing", requires: ["marketing.view"], phase: 7 },
  { href: "/admin/analytics", label: "Analytics & Reports", short: "Analytics", icon: "analytics", requires: ["reports.view"], phase: 7 },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: "settings",
    requires: ["settings.manage", "members.manage", "integrations.manage"],
    phase: 1,
  },
];

export function visibleNav(granted: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => hasAny(granted, item.requires));
}

export function navItemFor(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  staff: "Staff / Counselor",
  instructor: "Instructor",
};
