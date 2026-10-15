import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  beyondActor,
  builtinRolePermissions,
  candidateScope,
  decodeRoleChoice,
  encodeRoleChoice,
  groupPermissions,
  memberPermissions,
  missingNeeds,
  moduleState,
  moduleSummary,
  normalizePermissions,
  PERMISSION_INFO,
  PERMISSION_MODULES,
  permissionDiff,
  rolePermissions,
  sensitiveIn,
  setModule,
  togglePermission,
  withCandidateScope,
  withPermissionLabels,
  type RoleContext,
} from "./matrix";

const mod = (id: string) => PERMISSION_MODULES.find((m) => m.id === id)!;

describe("permission modules", () => {
  it("cover every permission exactly once, with plain text", () => {
    const all = PERMISSION_MODULES.flatMap((m) => m.permissions);
    expect([...all].sort()).toEqual([...PERMISSIONS].sort());
    expect(new Set(all).size).toBe(all.length);
    for (const p of PERMISSIONS) {
      expect(PERMISSION_INFO[p].label.length).toBeGreaterThan(3);
      expect(PERMISSION_INFO[p].description.length).toBeGreaterThan(10);
    }
  });

  it("are in the order the owner asked for", () => {
    expect(PERMISSION_MODULES.map((m) => m.label)).toEqual([
      "Dashboard",
      "Courses",
      "Candidates",
      "Demos",
      "Batches",
      "Calendar & attendance",
      "Finance",
      "Marketing & emails",
      "Analytics & reports",
      "Team & settings",
    ]);
  });

  it("flag finance, exports, settings and team permissions as sensitive", () => {
    expect(sensitiveIn([...PERMISSIONS])).toEqual(
      expect.arrayContaining(["finance.view", "finance.manage", "candidates.export", "reports.export", "settings.manage", "members.manage", "roles.manage"]),
    );
    expect(sensitiveIn(["dashboard.view", "courses.view"])).toEqual([]);
  });

  it("groups permissions with their state", () => {
    const g = groupPermissions(["finance.view"]);
    const finance = g.find((m) => m.id === "finance")!;
    expect(finance.state).toBe("some");
    expect(finance.items.map((i) => [i.key, i.on])).toEqual([
      ["finance.view", true],
      ["finance.manage", false],
    ]);
    expect(g.find((m) => m.id === "courses")!.state).toBe("none");
  });
});

describe("toggling", () => {
  it("managing switches on viewing, and switching viewing off switches managing off", () => {
    expect(togglePermission([], "finance.manage", true)).toEqual(["finance.view", "finance.manage"]);
    expect(togglePermission(["finance.view", "finance.manage", "dashboard.view"], "finance.view", false)).toEqual(["dashboard.view"]);
    expect(togglePermission(["sessions.view", "attendance.record", "sessions.manage"], "sessions.view", false)).toEqual([]);
  });

  it("candidate actions need a candidate scope", () => {
    expect(togglePermission([], "candidates.manage", true)).toEqual(["candidates.view_assigned", "candidates.manage"]);
    expect(togglePermission(["candidates.view_all"], "candidates.export", true)).toEqual(["candidates.view_all", "candidates.export"]);
    expect(togglePermission(["candidates.view_all", "candidates.manage"], "candidates.view_all", false)).toEqual([]);
  });

  it("candidate scope is one choice", () => {
    expect(candidateScope(["candidates.view_all", "candidates.view_assigned"])).toBe("all");
    expect(withCandidateScope(["candidates.view_all", "candidates.manage"], "assigned")).toEqual(["candidates.view_assigned", "candidates.manage"]);
    expect(withCandidateScope(["candidates.view_assigned", "candidates.manage", "dashboard.view"], "none")).toEqual(["dashboard.view"]);
    expect(togglePermission(["candidates.view_assigned"], "candidates.view_all", true)).toEqual(["candidates.view_all"]);
  });

  it("select all and clear work per module", () => {
    const on = setModule(["dashboard.view"], "calendar", true);
    expect(on).toEqual(["dashboard.view", "sessions.view", "sessions.manage", "attendance.record"]);
    expect(moduleState(on, mod("calendar"))).toBe("all");
    expect(setModule(on, "calendar", false)).toEqual(["dashboard.view"]);

    const cand = setModule([], "candidates", true);
    expect(cand).toEqual(["candidates.view_all", "candidates.manage", "candidates.import", "candidates.export"]);
    expect(moduleState(cand, mod("candidates"))).toBe("all");
    expect(moduleState(["candidates.view_assigned"], mod("candidates"))).toBe("some");
    expect(setModule(cand, "candidates", false)).toEqual([]);
    expect(setModule(["x.y"], "nope", true)).toEqual([]);
  });

  it("the built-in defaults are consistent", () => {
    // Same lists as the foundation migration.
    expect(missingNeeds(["dashboard.view", "courses.view", "candidates.view_assigned", "candidates.manage", "resources.view", "resources.share", "batches.view", "enrollments.manage", "sessions.view", "marketing.view"])).toEqual([]);
    expect(missingNeeds(["dashboard.view", "courses.view", "resources.view", "resources.manage", "batches.view", "sessions.view", "attendance.record"])).toEqual([]);
    expect(missingNeeds([...PERMISSIONS])).toEqual([]);
    expect(missingNeeds(["finance.manage", "candidates.export"])).toEqual(["candidates.view_assigned", "finance.view"]);
  });
});

describe("helpers", () => {
  it("normalizes, diffs and summarizes", () => {
    expect(normalizePermissions(["finance.view", "bogus.key", "dashboard.view", "finance.view"])).toEqual(["dashboard.view", "finance.view"]);
    expect(permissionDiff(["a.b", "finance.view"], ["finance.view", "finance.manage"])).toEqual({ added: ["finance.manage"], removed: [] });
    expect(moduleSummary(["dashboard.view", "finance.view", "finance.manage"])).toEqual(["Dashboard", "Finance"]);
  });

  it("finds permissions an actor would hand out without holding them", () => {
    expect(beyondActor(["finance.view", "dashboard.view"], { role: "admin", permissions: ["dashboard.view"] })).toEqual(["finance.view"]);
    expect(beyondActor(["finance.view"], { role: "owner", permissions: [] })).toEqual([]);
  });

  it("encodes and decodes role choices", () => {
    const id = "0b4f5c3e-1a2b-4c3d-8e9f-0123456789ab";
    expect(encodeRoleChoice("staff")).toBe("staff");
    expect(encodeRoleChoice("staff", id)).toBe(`custom:${id}`);
    expect(decodeRoleChoice(`custom:${id.toUpperCase()}`)).toEqual({ role: null, customRoleId: id });
    expect(decodeRoleChoice("instructor")).toEqual({ role: "instructor", customRoleId: null });
    expect(decodeRoleChoice("custom:nope")).toBeNull();
    expect(decodeRoleChoice("superuser")).toBeNull();
  });

  it("puts labels on permission keys in database messages", () => {
    expect(withPermissionLabels("You cannot give this role: you do not have finance.manage yourself")).toBe(
      "You cannot give this role: you do not have “Record payments and expenses” yourself",
    );
    expect(withPermissionLabels("see example.test")).toBe("see example.test");
  });
});

describe("role resolution (mirrors public.role_grants)", () => {
  const ctx: RoleContext = {
    defaults: { owner: [], admin: ["dashboard.view", "finance.view"], staff: ["dashboard.view", "marketing.view"], instructor: ["dashboard.view"] },
    orgChanges: { staff: { "marketing.view": false, "finance.view": true } },
    customRoles: { r1: ["finance.view", "finance.manage"] },
  };

  it("owner has everything", () => {
    expect(rolePermissions("owner", null, ctx)).toEqual([...PERMISSIONS]);
    expect(memberPermissions("owner", null, { "dashboard.view": false }, ctx)).toEqual([...PERMISSIONS]);
  });

  it("organization changes override the global defaults", () => {
    expect(builtinRolePermissions("staff", ctx)).toEqual(["dashboard.view", "finance.view"]);
    expect(builtinRolePermissions("instructor", ctx)).toEqual(["dashboard.view"]);
  });

  it("a custom role uses only its own list, and member overrides come last", () => {
    expect(rolePermissions("staff", "r1", ctx)).toEqual(["finance.view", "finance.manage"]);
    expect(memberPermissions("staff", "r1", { "finance.manage": false, "dashboard.view": true }, ctx)).toEqual(["dashboard.view", "finance.view"]);
    expect(rolePermissions("staff", "missing", ctx)).toEqual([]);
  });
});
