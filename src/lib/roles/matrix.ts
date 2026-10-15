/**
 * The permission matrix behind Settings › Roles & access: permissions grouped
 * by module with plain-language text, "select all" per module, the links
 * between permissions (managing needs viewing), warnings for sensitive ones,
 * and how a role resolves to permissions. Pure functions; the database
 * (public.has_permission and the role functions) enforces the same rules.
 */
import { isPermission, PERMISSIONS, type MemberRole, type Permission } from "@/lib/auth/permissions";

export type BuiltinEditableRole = Exclude<MemberRole, "owner">;
export const EDITABLE_ROLES: readonly BuiltinEditableRole[] = ["admin", "staff", "instructor"];

export type PermissionInfo = {
  label: string;
  description: string;
  /** Shown as a warning when the permission is switched on. */
  sensitive?: string;
};

export const PERMISSION_INFO: Record<Permission, PermissionInfo> = {
  "dashboard.view": { label: "See the dashboard", description: "The home page with today's follow-ups, classes and key numbers they are allowed to see." },
  "courses.view": { label: "View courses", description: "Course list, details, curriculum and pricing." },
  "courses.manage": { label: "Create and edit courses", description: "Add, edit, publish and archive courses and categories. Changes show on your public website." },
  "candidates.view_all": { label: "See every candidate", description: "All leads and students, whoever they are assigned to." },
  "candidates.view_assigned": { label: "See candidates assigned to them", description: "Only leads and students where they are the owner." },
  "candidates.manage": { label: "Update candidates", description: "Edit details, notes, status and follow-ups of the candidates they can see." },
  "candidates.import": { label: "Import candidates", description: "Upload lead lists from a CSV file." },
  "candidates.export": {
    label: "Export candidates",
    description: "Download candidate lists as CSV.",
    sensitive: "Lets them take a copy of names, phone numbers and emails out of the app.",
  },
  "resources.view": { label: "View demos and resources", description: "Demo recordings, notes and files." },
  "resources.manage": { label: "Add and edit demos and resources", description: "Upload and change demos and learning material." },
  "resources.share": { label: "Share demos with candidates", description: "Send demo and resource links to candidates." },
  "batches.view": { label: "View batches", description: "Batches and their rosters. Instructor-based roles only see the batches they teach." },
  "batches.manage": { label: "Create and edit batches", description: "Add batches, change schedules, capacity and instructors." },
  "enrollments.manage": { label: "Enroll students", description: "Add candidates to batches, move or drop enrollments." },
  "sessions.view": { label: "View the class calendar", description: "Class sessions. Instructor-based roles only see their own classes." },
  "sessions.manage": { label: "Schedule classes", description: "Create, reschedule and cancel class sessions." },
  "attendance.record": { label: "Mark attendance", description: "Record who attended each class." },
  "finance.view": {
    label: "View fees and payments",
    description: "Fee plans, payments, refunds, expenses and income totals.",
    sensitive: "Shows money: what each student paid and owes, and your business income and expenses.",
  },
  "finance.manage": {
    label: "Record payments and expenses",
    description: "Record payments, installments, discounts, refunds and expenses, and send payment links.",
    sensitive: "Can change money records and issue receipts.",
  },
  "marketing.view": { label: "View campaigns and emails", description: "Campaigns, tracking links, email templates and results." },
  "marketing.manage": { label: "Run campaigns and emails", description: "Create campaigns, links and templates, and send emails to candidates." },
  "reports.view": { label: "View analytics and reports", description: "Charts and reports, including revenue figures when they also have finance access." },
  "reports.export": {
    label: "Export reports",
    description: "Download reports as CSV.",
    sensitive: "Lets them take a copy of business data out of the app.",
  },
  "settings.manage": {
    label: "Change business settings",
    description: "Business profile, website text, lead statuses and sign-in switches for staff and instructors.",
    sensitive: "Can change how the whole business appears and who can sign in.",
  },
  "members.manage": {
    label: "Manage the team",
    description: "Invite people, change their roles, suspend or remove them. They can only give access they have themselves.",
    sensitive: "Can add and remove team members.",
  },
  "roles.manage": {
    label: "Manage roles",
    description: "Create and edit roles on this screen. They can only add permissions they have themselves, and never change administrator roles.",
    sensitive: "Can change what everyone else is allowed to do.",
  },
  "integrations.manage": {
    label: "Connect integrations",
    description: "Google Calendar, email provider, WhatsApp and payment gateway connections.",
    sensitive: "Can connect outside accounts that send emails and take payments in your name.",
  },
  "audit.view": { label: "View the activity log", description: "Who changed what and when." },
};

export type PermissionModule = { id: string; label: string; description: string; permissions: readonly Permission[] };

export const PERMISSION_MODULES: readonly PermissionModule[] = [
  { id: "dashboard", label: "Dashboard", description: "The home page.", permissions: ["dashboard.view"] },
  { id: "courses", label: "Courses", description: "Your course catalogue.", permissions: ["courses.view", "courses.manage"] },
  {
    id: "candidates",
    label: "Candidates",
    description: "Leads and students.",
    permissions: ["candidates.view_all", "candidates.view_assigned", "candidates.manage", "candidates.import", "candidates.export"],
  },
  { id: "demos", label: "Demos", description: "Demo recordings and learning resources.", permissions: ["resources.view", "resources.manage", "resources.share"] },
  { id: "batches", label: "Batches", description: "Batches, rosters and enrollments.", permissions: ["batches.view", "batches.manage", "enrollments.manage"] },
  { id: "calendar", label: "Calendar & attendance", description: "Class sessions and attendance.", permissions: ["sessions.view", "sessions.manage", "attendance.record"] },
  { id: "finance", label: "Finance", description: "Fees, payments, refunds and expenses.", permissions: ["finance.view", "finance.manage"] },
  { id: "marketing", label: "Marketing & emails", description: "Campaigns, tracking links and emails.", permissions: ["marketing.view", "marketing.manage"] },
  { id: "analytics", label: "Analytics & reports", description: "Charts, reports and exports.", permissions: ["reports.view", "reports.export"] },
  {
    id: "team",
    label: "Team & settings",
    description: "Business settings, people and roles.",
    permissions: ["settings.manage", "members.manage", "roles.manage", "integrations.manage", "audit.view"],
  },
];

/** Switching on the key also switches on what it needs; switching off a need switches off the key. */
const NEEDS: Partial<Record<Permission, readonly Permission[]>> = {
  "courses.manage": ["courses.view"],
  "resources.manage": ["resources.view"],
  "resources.share": ["resources.view"],
  "batches.manage": ["batches.view"],
  "enrollments.manage": ["batches.view"],
  "sessions.manage": ["sessions.view"],
  "attendance.record": ["sessions.view"],
  "finance.manage": ["finance.view"],
  "marketing.manage": ["marketing.view"],
  "reports.export": ["reports.view"],
};
const CANDIDATE_VIEW: readonly Permission[] = ["candidates.view_all", "candidates.view_assigned"];
const CANDIDATE_ACTIONS: readonly Permission[] = ["candidates.manage", "candidates.import", "candidates.export"];

/** Sorted, de-duplicated, known permissions only. */
export function normalizePermissions(list: readonly string[]): Permission[] {
  const set = new Set(list.filter(isPermission));
  return PERMISSIONS.filter((p) => set.has(p));
}

export type CandidateScope = "all" | "assigned" | "none";

export function candidateScope(perms: readonly string[]): CandidateScope {
  if (perms.includes("candidates.view_all")) return "all";
  if (perms.includes("candidates.view_assigned")) return "assigned";
  return "none";
}

/** Sets which candidates the role sees. "none" also removes the candidate actions. */
export function withCandidateScope(perms: readonly string[], scope: CandidateScope): Permission[] {
  const rest = perms.filter((p) => !CANDIDATE_VIEW.includes(p as Permission));
  if (scope === "none") return normalizePermissions(rest.filter((p) => !CANDIDATE_ACTIONS.includes(p as Permission)));
  return normalizePermissions([...rest, scope === "all" ? "candidates.view_all" : "candidates.view_assigned"]);
}

/** Toggles one permission, keeping its needs consistent. */
export function togglePermission(perms: readonly string[], key: Permission, on: boolean): Permission[] {
  if (CANDIDATE_VIEW.includes(key)) {
    if (on) return withCandidateScope(perms, key === "candidates.view_all" ? "all" : "assigned");
    const remaining = perms.filter((p) => p !== key);
    return candidateScope(remaining) === "none" ? withCandidateScope(remaining, "none") : normalizePermissions(remaining);
  }
  if (on) {
    const add: string[] = [key, ...(NEEDS[key] ?? [])];
    if (CANDIDATE_ACTIONS.includes(key) && candidateScope(perms) === "none") add.push("candidates.view_assigned");
    return normalizePermissions([...perms, ...add]);
  }
  const dependants = (Object.keys(NEEDS) as Permission[]).filter((k) => NEEDS[k]?.includes(key));
  return normalizePermissions(perms.filter((p) => p !== key && !dependants.includes(p as Permission)));
}

export type ModuleState = "all" | "some" | "none";

/** For candidates "all" means: every candidate plus every action (seeing only assigned ones is a narrower choice). */
export function moduleState(perms: readonly string[], mod: PermissionModule): ModuleState {
  const keys = mod.id === "candidates" ? (["candidates.view_all", ...CANDIDATE_ACTIONS] as Permission[]) : mod.permissions;
  const on = keys.filter((k) => perms.includes(k)).length;
  if (on === keys.length) return "all";
  if (on === 0 && !mod.permissions.some((k) => perms.includes(k))) return "none";
  return "some";
}

/** "Select all" / "Clear" for one module. */
export function setModule(perms: readonly string[], moduleId: string, on: boolean): Permission[] {
  const mod = PERMISSION_MODULES.find((m) => m.id === moduleId);
  if (!mod) return normalizePermissions(perms);
  const without = perms.filter((p) => !mod.permissions.includes(p as Permission));
  if (!on) {
    // Clearing a module also clears what depended on it elsewhere (none today, but keep it consistent).
    return mod.permissions.reduce<Permission[]>((acc, k) => togglePermission(acc, k, false), normalizePermissions(without));
  }
  const added = mod.id === "candidates" ? ["candidates.view_all", ...CANDIDATE_ACTIONS] : mod.permissions;
  return normalizePermissions([...without, ...added]);
}

export type GroupedModule = PermissionModule & {
  state: ModuleState;
  items: (PermissionInfo & { key: Permission; on: boolean })[];
};

export function groupPermissions(perms: readonly string[]): GroupedModule[] {
  return PERMISSION_MODULES.map((m) => ({
    ...m,
    state: moduleState(perms, m),
    items: m.permissions.map((key) => ({ key, on: perms.includes(key), ...PERMISSION_INFO[key] })),
  }));
}

export function sensitiveIn(perms: readonly string[]): Permission[] {
  return normalizePermissions(perms).filter((p) => PERMISSION_INFO[p].sensitive);
}

/** Permissions switched on whose needs are missing (should not happen through the UI). */
export function missingNeeds(perms: readonly string[]): Permission[] {
  const missing = new Set<Permission>();
  for (const p of normalizePermissions(perms)) for (const n of NEEDS[p] ?? []) if (!perms.includes(n)) missing.add(n);
  if (CANDIDATE_ACTIONS.some((a) => perms.includes(a)) && candidateScope(perms) === "none") missing.add("candidates.view_assigned");
  return normalizePermissions([...missing]);
}

/** Modules a role can open in the navigation, in plain words. */
export function moduleSummary(perms: readonly string[]): string[] {
  return PERMISSION_MODULES.filter((m) => m.permissions.some((k) => perms.includes(k))).map((m) => m.label);
}

export function permissionDiff(before: readonly string[], after: readonly string[]): { added: Permission[]; removed: Permission[] } {
  return {
    added: normalizePermissions(after.filter((p) => !before.includes(p))),
    removed: normalizePermissions(before.filter((p) => !after.includes(p))),
  };
}

/** Permissions the actor would hand out without holding them (owners hold everything). */
export function beyondActor(perms: readonly string[], actor: { role: MemberRole; permissions: readonly string[] }): Permission[] {
  if (actor.role === "owner") return [];
  return normalizePermissions(perms.filter((p) => !actor.permissions.includes(p)));
}

// -----------------------------------------------------------------------------
// Resolving a role (mirrors public.role_grants)
// -----------------------------------------------------------------------------

export type RoleContext = {
  /** Global defaults per built-in role (public.role_permissions). */
  defaults: Record<MemberRole, readonly string[]>;
  /** This organization's changes (public.organization_role_permissions). */
  orgChanges: Partial<Record<MemberRole, Record<string, boolean>>>;
  /** Permission lists of custom roles by id. */
  customRoles: Record<string, readonly string[]>;
};

export function builtinRolePermissions(role: MemberRole, ctx: RoleContext): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  const changes = ctx.orgChanges[role] ?? {};
  const base = new Set(ctx.defaults[role] ?? []);
  for (const [k, allowed] of Object.entries(changes)) {
    if (allowed) base.add(k);
    else base.delete(k);
  }
  return normalizePermissions([...base]);
}

export function rolePermissions(role: MemberRole, customRoleId: string | null | undefined, ctx: RoleContext): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  if (customRoleId) return normalizePermissions(ctx.customRoles[customRoleId] ?? []);
  return builtinRolePermissions(role, ctx);
}

/** Role plus per-member overrides, as the member experiences it. */
export function memberPermissions(role: MemberRole, customRoleId: string | null | undefined, overrides: Record<string, boolean>, ctx: RoleContext): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  const set = new Set<string>(rolePermissions(role, customRoleId, ctx));
  for (const [k, allowed] of Object.entries(overrides)) {
    if (allowed) set.add(k);
    else set.delete(k);
  }
  return normalizePermissions([...set]);
}

/** What the base role of a custom role decides, in plain words. */
export const BASE_ROLE_SCOPE: Record<BuiltinEditableRole, string> = {
  admin:
    "Administrator-based: sees all batches and classes. Only the owner can give, change or remove people with this role, and it is never switched off by the staff/instructor sign-in switches.",
  staff:
    "Staff-based: sees all batches and classes they have permission for. Signs in only while “Enable staff / counselor accounts” is on.",
  instructor:
    "Instructor-based: sees only the batches and classes they teach, and can be chosen as a batch instructor. Signs in only while “Enable instructor accounts” is on.",
};

// -----------------------------------------------------------------------------
// Role choice in the team screens: "staff" or "custom:<uuid>"
// -----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RoleChoice = { role: MemberRole; customRoleId: null } | { role: null; customRoleId: string };

export function encodeRoleChoice(role: MemberRole, customRoleId?: string | null): string {
  return customRoleId ? `custom:${customRoleId}` : role;
}

export function decodeRoleChoice(value: string): RoleChoice | null {
  if (value.startsWith("custom:")) {
    const id = value.slice("custom:".length);
    return UUID.test(id) ? { role: null, customRoleId: id.toLowerCase() } : null;
  }
  if (value === "owner" || value === "admin" || value === "staff" || value === "instructor") return { role: value, customRoleId: null };
  return null;
}

/** Replaces permission keys in a database message with their plain labels. */
export function withPermissionLabels(message: string): string {
  return message.replace(/\b[a-z_]+\.[a-z_]+\b/g, (k) => (isPermission(k) ? `“${PERMISSION_INFO[k].label}”` : k));
}
