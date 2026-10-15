import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createAuthUser, createTestDatabase } from "./harness";

let db: Client;
let drop: () => Promise<void>;
let orgId: string;
let ownerId: string;
let adminId: string;
let staffId: string;
let instructorId: string;
let outsiderId: string;

const SYNTHETIC = "@example.test"; // synthetic test identities only

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());

  ownerId = await createAuthUser(db, `owner${SYNTHETIC}`, "Test Owner");
  adminId = await createAuthUser(db, `admin${SYNTHETIC}`);
  staffId = await createAuthUser(db, `staff${SYNTHETIC}`);
  instructorId = await createAuthUser(db, `instructor${SYNTHETIC}`);
  outsiderId = await createAuthUser(db, `outsider${SYNTHETIC}`);

  orgId = await as(
    db,
    { role: "service_role" },
    async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "select public.bootstrap_organization($1, 'Test Academy', 'test-academy', 'Test Owner') as id",
        [ownerId],
      );
      return rows[0].id;
    },
    true,
  );

  await as(
    db,
    { role: "service_role" },
    async (c) => {
      await c.query(
        `insert into public.organization_memberships (organization_id, user_id, role) values
           ($1, $2, 'admin'), ($1, $3, 'staff'), ($1, $4, 'instructor')`,
        [orgId, adminId, staffId, instructorId],
      );
    },
    true,
  );
});

afterAll(async () => {
  await drop?.();
});

const owner = () => ({ role: "authenticated" as const, userId: ownerId });
const admin = () => ({ role: "authenticated" as const, userId: adminId });
const staff = () => ({ role: "authenticated" as const, userId: staffId });
const outsider = () => ({ role: "authenticated" as const, userId: outsiderId });

async function setFeatureFlags(staffEnabled: boolean, instructorsEnabled: boolean) {
  await as(
    db,
    { role: "service_role" },
    (c) =>
      c.query("update public.organizations set staff_enabled = $1, instructors_enabled = $2", [
        staffEnabled,
        instructorsEnabled,
      ]),
    true,
  );
}

describe("public (anon) visitors", () => {
  it.each(["organizations", "user_profiles", "organization_memberships", "audit_logs", "membership_permission_overrides"])(
    "cannot read %s",
    async (table) => {
      await expect(as(db, { role: "anon" }, (c) => c.query(`select * from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    },
  );

  it("can call the health check and setup probe only", async () => {
    const res = await as(db, { role: "anon" }, (c) =>
      c.query("select public.health_check() as ok, public.setup_required() as setup"),
    );
    expect(res.rows[0]).toEqual({ ok: true, setup: false });
    await expect(as(db, { role: "anon" }, (c) => c.query("select * from public.get_my_access()"))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("first-owner bootstrap", () => {
  it("cannot be called by anon or authenticated users", async () => {
    for (const who of [{ role: "anon" as const }, outsider()]) {
      await expect(
        as(db, who, (c) => c.query("select public.bootstrap_organization($1, 'Evil', 'evil')", [outsiderId])),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("only works once, even for the service role", async () => {
    await expect(
      as(db, { role: "service_role" }, (c) =>
        c.query("select public.bootstrap_organization($1, 'Second', 'second')", [outsiderId]),
      ),
    ).rejects.toThrow(/already been completed/);
  });

  it("created the owner membership, profile name and an audit entry", async () => {
    const { rows } = await db.query(
      `select m.role, p.full_name,
              (select count(*)::int from public.audit_logs where action = 'setup.completed') as audits
         from public.organization_memberships m join public.user_profiles p on p.id = m.user_id
        where m.user_id = $1`,
      [ownerId],
    );
    expect(rows[0]).toEqual({ role: "owner", full_name: "Test Owner", audits: 1 });
  });
});

describe("owner", () => {
  it("has every permission", async () => {
    const { rows } = await as(db, owner(), (c) => c.query("select role, permissions from public.get_my_access()"));
    const all = await db.query<{ key: string }>("select key from public.permissions");
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("owner");
    expect([...rows[0].permissions].sort()).toEqual(all.rows.map((r) => r.key).sort());
  });

  it("can update settings and the change is audited", async () => {
    const audits = await as(db, owner(), async (c) => {
      const upd = await c.query("update public.organizations set name = 'Renamed Academy' where id = $1", [orgId]);
      expect(upd.rowCount).toBe(1);
      const { rows } = await c.query(
        "select details from public.audit_logs where action = 'settings.updated' order by id desc limit 1",
      );
      return rows;
    });
    expect(audits[0].details.changed).toEqual({ name: "Renamed Academy" });
  });

  it("rejects an invalid time zone", async () => {
    await expect(
      as(db, owner(), (c) => c.query("update public.organizations set timezone = 'Mars/Olympus' where id = $1", [orgId])),
    ).rejects.toThrow(/Invalid time zone/);
  });

  it("cannot remove or demote themselves", async () => {
    await expect(
      as(db, owner(), (c) =>
        c.query("update public.organization_memberships set role = 'admin' where user_id = $1", [ownerId]),
      ),
    ).rejects.toThrow(/your own membership/);
  });
});

describe("outsider (signed in, no membership)", () => {
  it("sees nothing", async () => {
    const res = await as(db, outsider(), async (c) => ({
      orgs: (await c.query("select * from public.organizations")).rowCount,
      members: (await c.query("select * from public.organization_memberships")).rowCount,
      profiles: (await c.query("select * from public.user_profiles")).rows.map((r) => r.id),
      audit: (await c.query("select * from public.audit_logs")).rowCount,
      access: (await c.query("select * from public.get_my_access()")).rowCount,
    }));
    expect(res).toEqual({ orgs: 0, members: 0, profiles: [outsiderId], audit: 0, access: 0 });
  });

  it("cannot update the organization or insert memberships", async () => {
    const upd = await as(db, outsider(), (c) => c.query("update public.organizations set name = 'Hacked'"));
    expect(upd.rowCount).toBe(0);
    await expect(
      as(db, outsider(), (c) =>
        c.query("insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
          orgId,
          outsiderId,
        ]),
      ),
    ).rejects.toThrow(/row-level security|Not a member/);
  });

  it("cannot write to the audit log", async () => {
    await expect(
      as(db, outsider(), (c) => c.query("select public.write_audit_log($1, 'test.event')", [orgId])),
    ).rejects.toThrow(/Not a member/);
    await expect(
      as(db, outsider(), (c) =>
        c.query("insert into public.audit_logs (organization_id, action) values ($1, 'test.event')", [orgId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("staff", () => {
  it("has no access while the staff feature is disabled", async () => {
    await setFeatureFlags(false, false);
    const { rowCount } = await as(db, staff(), (c) => c.query("select * from public.get_my_access()"));
    expect(rowCount).toBe(0);
    const orgs = await as(db, staff(), (c) => c.query("select * from public.organizations"));
    expect(orgs.rowCount).toBe(0);
  });

  it("gets least-privilege permissions once enabled", async () => {
    await setFeatureFlags(true, false);
    const { rows } = await as(db, staff(), (c) => c.query("select permissions from public.get_my_access()"));
    const perms: string[] = rows[0].permissions;
    expect(perms).toContain("candidates.view_assigned");
    for (const forbidden of ["finance.view", "finance.manage", "candidates.view_all", "settings.manage", "audit.view", "reports.export", "members.manage"]) {
      expect(perms).not.toContain(forbidden);
    }
  });

  it("cannot change settings, read the audit log, or grant itself admin", async () => {
    await setFeatureFlags(true, false);
    const upd = await as(db, staff(), (c) => c.query("update public.organizations set name = 'Staff Rename'"));
    expect(upd.rowCount).toBe(0);
    const audit = await as(db, staff(), (c) => c.query("select * from public.audit_logs"));
    expect(audit.rowCount).toBe(0);
    const promote = await as(db, staff(), (c) =>
      c.query("update public.organization_memberships set role = 'admin' where user_id = $1", [staffId]),
    ).catch((e: Error) => e);
    // Either filtered by RLS (0 rows) or blocked by the trigger; never applied.
    if (!(promote instanceof Error)) expect(promote.rowCount).toBe(0);
    const { rows } = await db.query("select role from public.organization_memberships where user_id = $1", [staffId]);
    expect(rows[0].role).toBe("staff");
  });

  it("cannot read another user's email column changes or update other profiles", async () => {
    await setFeatureFlags(true, false);
    const upd = await as(db, staff(), (c) =>
      c.query("update public.user_profiles set full_name = 'x' where id = $1", [ownerId]),
    );
    expect(upd.rowCount).toBe(0);
    await expect(
      as(db, staff(), (c) => c.query("update public.user_profiles set email = 'x@example.test' where id = $1", [staffId])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("admin", () => {
  it("cannot create another owner or demote the owner", async () => {
    await expect(
      as(db, admin(), (c) =>
        c.query("insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
          orgId,
          outsiderId,
        ]),
      ),
    ).rejects.toThrow(/Only the owner/);
    await expect(
      as(db, admin(), (c) =>
        c.query("update public.organization_memberships set status = 'suspended' where user_id = $1", [ownerId]),
      ),
    ).rejects.toThrow(/Only the owner/);
  });

  it("can add an instructor, which is audited", async () => {
    const actions = await as(db, admin(), async (c) => {
      await c.query(
        "insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'instructor')",
        [orgId, outsiderId],
      );
      return (await c.query("select action, actor_id from public.audit_logs where action = 'member.added' and actor_id = $1", [adminId])).rows;
    });
    expect(actions).toHaveLength(1);
  });

  it("loses a permission when the owner revokes it with an override", async () => {
    const membership = await db.query<{ id: string }>(
      "select id from public.organization_memberships where user_id = $1",
      [adminId],
    );
    await as(db, owner(), (c) =>
      c.query("insert into public.membership_permission_overrides (membership_id, permission_key, allowed) values ($1, 'finance.view', false)", [
        membership.rows[0].id,
      ]),
    true);
    const { rows } = await as(db, admin(), (c) => c.query("select public.has_permission($1, 'finance.view') as ok", [orgId]));
    expect(rows[0].ok).toBe(false);
  });
});

describe("integrity", () => {
  it("keeps at least one active owner, even for the service role", async () => {
    await expect(
      as(db, { role: "service_role" }, (c) => c.query("delete from public.organization_memberships where user_id = $1", [ownerId])),
    ).rejects.toThrow(/at least one active owner/);
  });

  it("makes audit entries immutable", async () => {
    await expect(
      as(db, { role: "service_role" }, (c) => c.query("delete from public.audit_logs")),
    ).rejects.toThrow(/immutable/);
  });

  it("has RLS enabled on every public table", async () => {
    const { rows } = await db.query(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    expect(rows).toEqual([]);
  });
});
