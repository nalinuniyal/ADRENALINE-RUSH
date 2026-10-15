import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createAuthUser, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let org: Org;
let adminId: string;
let memberId: string; // a staff member we move between roles
let teacherId: string; // second instructor, for batch scope
let otherOrgId: string;
let otherOwnerId: string;

const service = { role: "service_role" as const };
let seq = 1;
const hash = () => (seq++).toString(16).padStart(64, "0");

async function q<T = Record<string, unknown>>(who: Parameters<typeof as>[1], sql: string, params: unknown[] = [], commit = true): Promise<T[]> {
  return as(db, who, async (c) => (await c.query(sql, params)).rows as T[], commit);
}
const perms = async (userId: string): Promise<string[]> =>
  (await q<{ permissions: string[] }>(user(userId), "select permissions from public.get_my_access_v2()"))[0]?.permissions ?? [];
const defaults = async (role: string): Promise<string[]> =>
  (await q<{ k: string }>(service, "select permission_key as k from public.role_permissions where role = $1 order by 1", [role])).map((r) => r.k);
const membership = async (userId: string) =>
  (await q<{ id: string; role: string; custom_role_id: string | null }>(service, "select id, role, custom_role_id from public.organization_memberships where user_id = $1 and organization_id = $2", [userId, org.orgId]))[0];

async function createRole(actor: string, name: string, base: string, permissions: string[], orgId = org.orgId, commit = true): Promise<string> {
  const rows = await q<{ id: string }>(user(actor), "select public.create_custom_role($1, $2, 'Synthetic role', $3, $4) as id", [orgId, name, base, permissions], commit);
  return rows[0].id;
}
async function assign(actor: string, targetUser: string, role: string, customRoleId: string | null, commit = true) {
  return q(user(actor), "update public.organization_memberships set role = $1, custom_role_id = $2 where user_id = $3 and organization_id = $4 returning id", [role, customRoleId, targetUser, org.orgId], commit);
}

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  org = await seedOrg(db);
  adminId = await createAuthUser(db, "admin@example.test", "Test Admin");
  memberId = await createAuthUser(db, "member@example.test", "Test Member");
  teacherId = await createAuthUser(db, "teacher@example.test", "Second Instructor");
  otherOwnerId = await createAuthUser(db, "other-owner@example.test", "Other Owner");
  await as(
    db,
    service,
    async (c) => {
      await c.query(
        "insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'staff'), ($1, $4, 'instructor')",
        [org.orgId, adminId, memberId, teacherId],
      );
      otherOrgId = (await c.query<{ id: string }>("insert into public.organizations (name, slug) values ('Other Academy', 'other-academy') returning id")).rows[0].id;
      await c.query("insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [otherOrgId, otherOwnerId]);
    },
    true,
  );
});

afterAll(async () => {
  await drop?.();
});

describe("existing access is unchanged", () => {
  it("built-in roles resolve to exactly the global defaults", async () => {
    expect(await perms(memberId)).toEqual(await defaults("staff"));
    expect(await perms(org.instructorId)).toEqual(await defaults("instructor"));
    expect(await perms(adminId)).toEqual(await defaults("admin"));
    // The older access function agrees with the new one.
    const legacy = await q<{ permissions: string[] }>(user(adminId), "select permissions from public.get_my_access()");
    expect(legacy[0].permissions).toEqual(await perms(adminId));
  });

  it("roles.manage is held by the owner only", async () => {
    expect(await perms(org.ownerId)).toContain("roles.manage");
    for (const id of [adminId, memberId, org.instructorId]) expect(await perms(id)).not.toContain("roles.manage");
    expect(await defaults("admin")).not.toContain("roles.manage");
    expect(await defaults("admin")).toContain("members.manage");
  });

  it("no organization changes or custom roles exist after the migration", async () => {
    const [a] = await q<{ n: number }>(service, "select count(*)::int as n from public.organization_role_permissions");
    const [b] = await q<{ n: number }>(service, "select count(*)::int as n from public.organization_memberships where custom_role_id is not null");
    expect([a.n, b.n]).toEqual([0, 0]);
  });
});

describe("row level security on the new tables", () => {
  it("anon cannot read anything or call the role functions", async () => {
    for (const t of ["custom_roles", "custom_role_permissions", "organization_role_permissions"]) {
      await expect(q({ role: "anon" }, `select * from public.${t}`, [], false)).rejects.toThrow(/permission denied/);
    }
    await expect(q({ role: "anon" }, "select public.create_custom_role($1, 'X role', null, 'staff', '{}')", [org.orgId], false)).rejects.toThrow(/permission denied/);
  });

  it("app users cannot write the tables directly, even the owner", async () => {
    await expect(
      q(user(org.ownerId), "insert into public.custom_roles (organization_id, name, base_role) values ($1, 'Direct', 'staff')", [org.orgId], false),
    ).rejects.toThrow(/permission denied/);
    await expect(
      q(user(org.ownerId), "insert into public.organization_role_permissions (organization_id, role, permission_key, allowed) values ($1, 'staff', 'finance.view', true)", [org.orgId], false),
    ).rejects.toThrow(/permission denied/);
  });

  it("members see role names; only member or role managers see what roles grant; other organizations see nothing", async () => {
    const id = await createRole(org.ownerId, "Visible Role", "staff", ["dashboard.view"]);
    expect(await q(user(memberId), "select name from public.custom_roles where id = $1", [id])).toHaveLength(1);
    expect(await q(user(memberId), "select * from public.custom_role_permissions where role_id = $1", [id])).toHaveLength(0);
    expect(await q(user(adminId), "select * from public.custom_role_permissions where role_id = $1", [id])).toHaveLength(1);
    expect(await q(user(otherOwnerId), "select name from public.custom_roles where id = $1", [id])).toHaveLength(0);
    expect(await q(user(org.outsiderId), "select name from public.custom_roles")).toHaveLength(0);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [id]);
  });
});

describe("resolution order", () => {
  it("organization changes to a built-in role apply to everyone with it, and reset restores the defaults", async () => {
    const staffDefaults = await defaults("staff");
    const changed = [...staffDefaults.filter((p) => p !== "marketing.view"), "finance.view"].sort();
    await q(user(org.ownerId), "select public.set_builtin_role_permissions($1, 'staff', $2)", [org.orgId, changed]);
    expect(await perms(memberId)).toEqual(changed);
    expect(await perms(org.staffId)).toEqual(changed);
    // Only differences are stored.
    const rows = await q<{ permission_key: string; allowed: boolean }>(service, "select permission_key, allowed from public.organization_role_permissions where organization_id = $1 order by 1", [org.orgId]);
    expect(rows).toEqual([
      { permission_key: "finance.view", allowed: true },
      { permission_key: "marketing.view", allowed: false },
    ]);
    // Another organization is not affected.
    const otherStaff = await q<{ ok: boolean }>(service, "select public.role_grants($1, 'staff', null, 'finance.view') as ok", [otherOrgId]);
    expect(otherStaff[0].ok).toBe(false);

    await q(user(org.ownerId), "select public.reset_builtin_role_permissions($1, 'staff')", [org.orgId]);
    expect(await perms(memberId)).toEqual(staffDefaults);
  });

  it("a per-member override beats the role; a custom role ignores the base role's settings", async () => {
    await q(user(org.ownerId), "select public.set_builtin_role_permissions($1, 'staff', $2)", [org.orgId, [...(await defaults("staff")), "reports.view"]]);
    const roleId = await createRole(org.ownerId, "Counsellor read only", "staff", ["dashboard.view", "candidates.view_all"]);
    await assign(org.ownerId, memberId, "staff", roleId);
    expect(await perms(memberId)).toEqual(["candidates.view_all", "dashboard.view"]);

    const m = await membership(memberId);
    await q(user(org.ownerId), "insert into public.membership_permission_overrides (membership_id, permission_key, allowed) values ($1, 'courses.view', true), ($1, 'dashboard.view', false)", [m.id]);
    expect(await perms(memberId)).toEqual(["candidates.view_all", "courses.view"]);

    await q(user(org.ownerId), "delete from public.membership_permission_overrides where membership_id = $1", [m.id]);
    await assign(org.ownerId, memberId, "staff", null);
    expect(await perms(memberId)).toContain("reports.view");
    await q(user(org.ownerId), "select public.reset_builtin_role_permissions($1, 'staff')", [org.orgId]);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [roleId]);
  });

  it("the owner always has everything and cannot be edited", async () => {
    await expect(q(user(org.ownerId), "select public.set_builtin_role_permissions($1, 'owner', '{}')", [org.orgId], false)).rejects.toThrow(/owner role/);
    await expect(q(user(org.ownerId), "select public.create_custom_role($1, 'Second owner', null, 'owner', '{}')", [org.orgId], false)).rejects.toThrow(/check constraint|owner role/);
  });

  it("a custom role copies its base role into the membership, so sign-in switches apply", async () => {
    const roleId = await createRole(org.ownerId, "Senior instructor", "instructor", ["dashboard.view", "batches.view", "sessions.view", "sessions.manage"]);
    await q(user(org.ownerId), "update public.organization_memberships set custom_role_id = $1 where user_id = $2 and organization_id = $3", [roleId, memberId, org.orgId]);
    expect((await membership(memberId)).role).toBe("instructor");
    await q(service, "update public.organizations set instructors_enabled = false where id = $1", [org.orgId]);
    expect(await perms(memberId)).toEqual([]);
    await q(service, "update public.organizations set instructors_enabled = true where id = $1", [org.orgId]);
    await assign(org.ownerId, memberId, "staff", null);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [roleId]);
  });
});

describe("no privilege escalation", () => {
  it("only role managers create or edit roles", async () => {
    for (const id of [adminId, memberId, org.instructorId, org.outsiderId]) {
      await expect(createRole(id, "Sneaky", "staff", [], org.orgId, false)).rejects.toThrow(/Only the owner can change roles/);
      await expect(q(user(id), "select public.set_builtin_role_permissions($1, 'staff', '{finance.manage}')", [org.orgId], false)).rejects.toThrow(/Only the owner/);
    }
  });

  it("a role manager who is not the owner cannot add permissions they lack or touch admin roles", async () => {
    // The owner lets administrators manage roles, but takes finance.manage away from them.
    const adminSet = [...(await defaults("admin")).filter((p) => p !== "finance.manage"), "roles.manage"];
    await q(user(org.ownerId), "select public.set_builtin_role_permissions($1, 'admin', $2)", [org.orgId, adminSet]);
    expect(await perms(adminId)).toContain("roles.manage");

    await expect(createRole(adminId, "Accounts plus", "staff", ["finance.view", "finance.manage"], org.orgId, false)).rejects.toThrow(/finance\.manage yourself/);
    await expect(createRole(adminId, "Deputy", "admin", ["dashboard.view"], org.orgId, false)).rejects.toThrow(/Only the owner can change administrator roles/);
    await expect(q(user(adminId), "select public.set_builtin_role_permissions($1, 'admin', $2)", [org.orgId, [...adminSet, "finance.manage"]], false)).rejects.toThrow(
      /Only the owner can change administrator roles/,
    );
    await expect(q(user(adminId), "select public.set_builtin_role_permissions($1, 'staff', '{finance.manage}')", [org.orgId], false)).rejects.toThrow(/finance\.manage yourself/);

    // Within their own permissions it works, and keeping a permission they lack is allowed.
    const ownerRole = await createRole(org.ownerId, "Accounts", "staff", ["finance.view", "finance.manage"]);
    await q(user(adminId), "select public.update_custom_role($1, 'Accounts', 'Edited by admin', $2)", [ownerRole, ["finance.view", "finance.manage", "dashboard.view"]]);
    await expect(q(user(adminId), "select public.update_custom_role($1, 'Accounts', null, $2)", [ownerRole, ["finance.view", "finance.manage", "dashboard.view", "settings.manage"]], false)).resolves.toBeTruthy();
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [ownerRole]);
    await q(user(org.ownerId), "select public.reset_builtin_role_permissions($1, 'admin')", [org.orgId]);
  });

  it("a member manager cannot give or invite with a role holding permissions they lack", async () => {
    await q(user(org.ownerId), "select public.set_builtin_role_permissions($1, 'admin', $2)", [org.orgId, (await defaults("admin")).filter((p) => p !== "finance.manage")]);
    const accounts = await createRole(org.ownerId, "Accounts", "staff", ["finance.view", "finance.manage"]);
    const viewer = await createRole(org.ownerId, "Finance viewer", "staff", ["finance.view"]);

    await expect(assign(adminId, memberId, "staff", accounts, false)).rejects.toThrow(/You cannot give this role: you do not have finance\.manage/);
    await expect(
      q(user(adminId), "insert into public.team_invitations (organization_id, email, full_name, role, custom_role_id, token_hash, expires_at) values ($1, 'acc@example.test', 'Accounts Person', 'staff', $2, $3, now() + interval '7 days')", [org.orgId, accounts, hash()], false),
    ).rejects.toThrow(/You cannot invite someone with this role/);
    // A role within their permissions is fine.
    await assign(adminId, memberId, "staff", viewer);
    expect(await perms(memberId)).toEqual(["finance.view"]);
    await assign(adminId, memberId, "staff", null);

    // A built-in role the owner widened beyond the admin's permissions is blocked too.
    await q(user(org.ownerId), "select public.set_builtin_role_permissions($1, 'instructor', $2)", [org.orgId, [...(await defaults("instructor")), "finance.manage"]]);
    await expect(assign(adminId, memberId, "instructor", null, false)).rejects.toThrow(/finance\.manage/);
    // The owner can.
    await assign(org.ownerId, memberId, "staff", accounts, false);

    await q(user(org.ownerId), "select public.reset_builtin_role_permissions($1, 'instructor')", [org.orgId]);
    await q(user(org.ownerId), "select public.reset_builtin_role_permissions($1, 'admin')", [org.orgId]);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [accounts]);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [viewer]);
  });

  it("admin-based roles and the owner role are given by the owner only", async () => {
    const deputy = await createRole(org.ownerId, "Deputy", "admin", ["dashboard.view", "members.manage"]);
    await expect(assign(adminId, memberId, "staff", deputy, false)).rejects.toThrow(/Only the owner/);
    await expect(assign(adminId, memberId, "owner", null, false)).rejects.toThrow(/Only the owner/);
    await assign(org.ownerId, memberId, "staff", deputy);
    expect((await membership(memberId)).role).toBe("admin");
    // Now the admin cannot change that member either.
    await expect(assign(adminId, memberId, "staff", null, false)).rejects.toThrow(/Only the owner/);
    await assign(org.ownerId, memberId, "staff", null);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [deputy]);
  });

  it("a role from another organization cannot be used", async () => {
    const foreign = await createRole(otherOwnerId, "Foreign", "staff", ["dashboard.view"], otherOrgId);
    await expect(assign(org.ownerId, memberId, "staff", foreign, false)).rejects.toThrow(/does not belong|foreign key/);
    await expect(q(user(org.ownerId), "select public.update_custom_role($1, 'Hijack', null, '{}')", [foreign], false)).rejects.toThrow(/could not be found/);
    await expect(q(user(org.ownerId), "select public.delete_custom_role($1)", [foreign], false)).rejects.toThrow(/could not be found/);
  });

  it("rejects unknown permissions and duplicate names", async () => {
    await expect(createRole(org.ownerId, "Typo", "staff", ["finance.everything"], org.orgId, false)).rejects.toThrow(/Unknown permission/);
    const id = await createRole(org.ownerId, "Unique Name", "staff", []);
    await expect(createRole(org.ownerId, "unique name", "staff", [], org.orgId, false)).rejects.toThrow(/already exists/);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [id]);
  });
});

describe("data scope follows the base role", () => {
  let courseId: string;
  let ownBatch: string;
  let otherBatch: string;

  beforeAll(async () => {
    courseId = (await q<{ id: string }>(user(org.ownerId), "insert into public.courses (organization_id, title, slug, status) values ($1, 'Scope Course', 'scope-course', 'published') returning id", [org.orgId]))[0].id;
    ownBatch = (await q<{ id: string }>(user(org.ownerId), "insert into public.batches (organization_id, course_id, name, status, instructor_id) values ($1, $2, 'Taught by member', 'open', $3) returning id", [org.orgId, courseId, memberId]))[0].id;
    otherBatch = (await q<{ id: string }>(user(org.ownerId), "insert into public.batches (organization_id, course_id, name, status, instructor_id) values ($1, $2, 'Taught by someone else', 'open', $3) returning id", [org.orgId, courseId, teacherId]))[0].id;
  });

  it("an instructor-based role sees only the batches it teaches; a staff-based one sees all", async () => {
    const teaching = await createRole(org.ownerId, "Lead trainer", "instructor", ["batches.view", "sessions.view"]);
    await assign(org.ownerId, memberId, "staff", teaching);
    const seen = (await q<{ id: string }>(user(memberId), "select id from public.batches where course_id = $1", [courseId])).map((r) => r.id);
    expect(seen).toEqual([ownBatch]);

    const coordinator = await createRole(org.ownerId, "Coordinator", "staff", ["batches.view"]);
    await assign(org.ownerId, memberId, "staff", coordinator);
    const all = (await q<{ id: string }>(user(memberId), "select id from public.batches where course_id = $1 order by name", [courseId])).map((r) => r.id);
    expect(all.sort()).toEqual([ownBatch, otherBatch].sort());

    await assign(org.ownerId, memberId, "staff", null);
    for (const id of [teaching, coordinator]) await q(user(org.ownerId), "select public.delete_custom_role($1)", [id]);
  });

  it("candidate scope follows view_all / view_assigned, and the owner picker uses the same resolution", async () => {
    await q(user(org.ownerId), "insert into public.candidates (organization_id, full_name, email, owner_id) values ($1, 'Assigned Lead', 'assigned@example.test', $2), ($1, 'Other Lead', 'other-lead@example.test', null)", [org.orgId, memberId]);
    const assigned = await createRole(org.ownerId, "Counsellor", "staff", ["candidates.view_assigned", "candidates.manage"]);
    await assign(org.ownerId, memberId, "staff", assigned);
    const mine = await q<{ full_name: string }>(user(memberId), "select full_name from public.candidates order by 1");
    expect(mine.map((r) => r.full_name)).toEqual(["Assigned Lead"]);
    const owners = await q<{ user_id: string }>(user(org.ownerId), "select user_id from public.list_candidate_owners($1)", [org.orgId]);
    expect(owners.map((r) => r.user_id)).toContain(memberId);

    const readOnly = await createRole(org.ownerId, "Counsellor read only", "staff", ["candidates.view_all"]);
    await assign(org.ownerId, memberId, "staff", readOnly);
    const every = await q<{ full_name: string }>(user(memberId), "select full_name from public.candidates where full_name like '%Lead' order by 1");
    expect(every.map((r) => r.full_name)).toEqual(["Assigned Lead", "Other Lead"]);
    const owners2 = await q<{ user_id: string }>(user(org.ownerId), "select user_id from public.list_candidate_owners($1)", [org.orgId]);
    expect(owners2.map((r) => r.user_id)).not.toContain(memberId);
    await expect(q(user(memberId), "update public.candidates set full_name = 'Changed' where full_name = 'Other Lead' returning id")).resolves.toHaveLength(0);

    await assign(org.ownerId, memberId, "staff", null);
    for (const id of [assigned, readOnly]) await q(user(org.ownerId), "select public.delete_custom_role($1)", [id]);
  });
});

describe("deleting, inviting and auditing", () => {
  it("a role in use or on an open invitation cannot be deleted", async () => {
    const id = await createRole(org.ownerId, "In use", "staff", ["dashboard.view"]);
    await assign(org.ownerId, memberId, "staff", id);
    await expect(q(user(org.ownerId), "select public.delete_custom_role($1)", [id], false)).rejects.toThrow(/1 team member\(s\) still have this role/);
    await assign(org.ownerId, memberId, "staff", null);

    const [inv] = await q<{ id: string }>(
      user(org.ownerId),
      "insert into public.team_invitations (organization_id, email, full_name, role, custom_role_id, token_hash, expires_at) values ($1, 'pending-role@example.test', 'Pending Person', 'instructor', $2, $3, now() + interval '7 days') returning id",
      [org.orgId, id, hash()],
    );
    // The invitation takes the role's base role, whatever was sent.
    expect((await q<{ role: string }>(service, "select role from public.team_invitations where id = $1", [inv.id]))[0].role).toBe("staff");
    await expect(q(user(org.ownerId), "select public.delete_custom_role($1)", [id], false)).rejects.toThrow(/open invitation/);
    await q(user(org.ownerId), "update public.team_invitations set status = 'revoked' where id = $1", [inv.id]);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [id]);
    expect((await q<{ custom_role_id: string | null }>(service, "select custom_role_id from public.team_invitations where id = $1", [inv.id]))[0].custom_role_id).toBeNull();
  });

  it("accepting an invitation gives the custom role", async () => {
    const id = await createRole(org.ownerId, "Accounts invite", "staff", ["finance.view"]);
    const token = hash();
    await q(user(org.ownerId), "insert into public.team_invitations (organization_id, email, full_name, role, custom_role_id, token_hash, expires_at) values ($1, 'accounts@example.test', 'Accounts Person', 'staff', $2, $3, now() + interval '7 days')", [org.orgId, id, token]);
    const newUser = await createAuthUser(db, "accounts@example.test");
    const [res] = await q<{ result: string }>(service, "select * from public.accept_team_invitation($1, $2, 'Accounts Person')", [token, newUser]);
    expect(res.result).toBe("ok");
    const [row] = await q<{ custom_role_name: string; permissions: string[] }>(user(newUser), "select custom_role_name, permissions from public.get_my_access_v2()");
    expect(row).toEqual({ custom_role_name: "Accounts invite", permissions: ["finance.view"] });
    // Invitations cannot switch roles afterwards.
    await expect(q(user(org.ownerId), "update public.team_invitations set custom_role_id = null where token_hash = $1", [token], false)).rejects.toThrow(/permission denied|cannot be edited/);
  });

  it("writes audit entries for create, edit, delete, assign and built-in changes", async () => {
    const id = await createRole(org.ownerId, "Audited", "staff", ["dashboard.view"]);
    await q(user(org.ownerId), "select public.update_custom_role($1, 'Audited role', null, '{dashboard.view,courses.view}')", [id]);
    await assign(org.ownerId, memberId, "staff", id);
    await assign(org.ownerId, memberId, "staff", null);
    await q(user(org.ownerId), "select public.delete_custom_role($1)", [id]);
    const rows = await q<{ action: string; details: Record<string, unknown> }>(service, "select action, details from public.audit_logs where entity_id = $1 or (action = 'role.assigned' and details->>'previous_custom_role_id' = $1::text) or (action = 'role.assigned' and details->>'custom_role_id' = $1::text) order by id", [id]);
    expect(rows.map((r) => r.action)).toEqual(["role.created", "role.updated", "role.assigned", "role.assigned", "role.deleted"]);
    expect(rows[1].details).toMatchObject({ added: ["courses.view"], removed: [], previous_name: "Audited", name: "Audited role" });
    expect(rows[2].details).toMatchObject({ custom_role_name: "Audited role", previous_role: "staff" });

    const before = (await q<{ n: number }>(service, "select count(*)::int as n from public.audit_logs where action = 'role.defaults_changed'"))[0].n;
    await q(user(org.ownerId), "select public.set_builtin_role_permissions($1, 'instructor', '{dashboard.view}')", [org.orgId]);
    await q(user(org.ownerId), "select public.reset_builtin_role_permissions($1, 'instructor')", [org.orgId]);
    const after = (await q<{ n: number }>(service, "select count(*)::int as n from public.audit_logs where action = 'role.defaults_changed'"))[0].n;
    expect(after - before).toBe(2);
  });
});
