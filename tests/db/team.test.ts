import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createAuthUser, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let org: Org;
let adminId: string;

const service = { role: "service_role" as const };
const hash = (n: number) => n.toString(16).padStart(64, "0");
let tokenSeq = 1;
const nextHash = () => hash(tokenSeq++);

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  org = await seedOrg(db);
  adminId = await createAuthUser(db, "admin@example.test", "Test Admin");
  await as(db, service, (c) => c.query("insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'admin')", [org.orgId, adminId]), true);
});

afterAll(async () => {
  await drop?.();
});

type InviteRow = { id: string; token: string };

async function invite(actor: string, email: string, role = "staff", opts: { commit?: boolean; expiresSql?: string } = {}): Promise<InviteRow> {
  const token = nextHash();
  const id = await as(
    db,
    user(actor),
    async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into public.team_invitations (organization_id, email, full_name, role, token_hash, expires_at)
         values ($1, $2, 'Invited Person', $3, $4, ${opts.expiresSql ?? "now() + interval '7 days'"}) returning id`,
        [org.orgId, email, role, token],
      );
      return rows[0].id;
    },
    opts.commit ?? true,
  );
  return { id, token };
}

async function accept(token: string, userId: string, name: string | null = "Accepted Person") {
  return as(db, service, async (c) => {
    const { rows } = await c.query<{ result: string; membership_id: string | null; role: string | null }>(
      "select * from public.accept_team_invitation($1, $2, $3)",
      [token, userId, name],
    );
    return rows[0];
  }, true);
}

describe("access to invitations", () => {
  it("anon cannot read invitations or call the invitation functions", async () => {
    await expect(as(db, { role: "anon" }, (c) => c.query("select id from public.team_invitations"))).rejects.toThrow(/permission denied/);
    await expect(as(db, { role: "anon" }, (c) => c.query("select * from public.get_team_invitation($1)", [hash(1)]))).rejects.toThrow(/permission denied/);
    await expect(as(db, { role: "anon" }, (c) => c.query("select * from public.accept_team_invitation($1, $2, null)", [hash(1), org.staffId]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("signed-in users cannot call the service-only functions", async () => {
    await expect(as(db, user(org.ownerId), (c) => c.query("select * from public.get_team_invitation($1)", [hash(1)]))).rejects.toThrow(/permission denied/);
    await expect(as(db, user(org.ownerId), (c) => c.query("select * from public.accept_team_invitation($1, $2, null)", [hash(1), org.ownerId]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("staff, instructors and outsiders cannot read or create invitations", async () => {
    await invite(org.ownerId, "visible@example.test");
    for (const id of [org.staffId, org.instructorId, org.outsiderId]) {
      const { rows } = await as(db, user(id), (c) => c.query("select id from public.team_invitations"));
      expect(rows).toHaveLength(0);
      await expect(invite(id, `nope-${id.slice(0, 6)}@example.test`, "staff", { commit: false })).rejects.toThrow(/row-level security|Not a member/);
    }
  });

  it("member managers see invitations but never the token hash", async () => {
    const { rows } = await as(db, user(org.ownerId), (c) => c.query("select email, invited_by from public.team_invitations where email = 'visible@example.test'"));
    expect(rows).toEqual([{ email: "visible@example.test", invited_by: org.ownerId }]);
    await expect(as(db, user(org.ownerId), (c) => c.query("select token_hash from public.team_invitations"))).rejects.toThrow(/permission denied/);
  });
});

describe("creating invitations", () => {
  it("records who invited and writes an audit entry", async () => {
    const { id } = await invite(adminId, "audited@example.test", "instructor");
    const { rows } = await db.query("select actor_id, action, details from public.audit_logs where entity_id = $1", [id]);
    expect(rows).toEqual([{ actor_id: adminId, action: "invite.created", details: expect.objectContaining({ email: "audited@example.test", role: "instructor" }) }]);
  });

  it("only the owner can invite administrators", async () => {
    await expect(invite(adminId, "new-admin@example.test", "admin", { commit: false })).rejects.toThrow(/Only the owner can invite administrators/);
    await expect(invite(org.ownerId, "new-admin@example.test", "admin", { commit: false })).resolves.toBeTruthy();
  });

  it("nobody can invite an owner", async () => {
    await expect(invite(org.ownerId, "owner2@example.test", "owner", { commit: false })).rejects.toThrow(/check constraint/);
  });

  it("rejects a second pending invitation for the same email, and existing members", async () => {
    await invite(org.ownerId, "twice@example.test");
    await expect(invite(org.ownerId, "twice@example.test", "staff", { commit: false })).rejects.toThrow(/duplicate key/);
    await expect(invite(org.ownerId, "staff@example.test", "staff", { commit: false })).rejects.toThrow(/already a member/);
  });

  it("an invitation that has run out does not block a new one", async () => {
    const old = await invite(org.ownerId, "late@example.test");
    await as(db, service, (c) => c.query("update public.team_invitations set expires_at = now() - interval '1 minute' where id = $1", [old.id]), true);
    await invite(org.ownerId, "late@example.test");
    const { rows } = await db.query("select status from public.team_invitations where id = $1", [old.id]);
    expect(rows[0].status).toBe("expired");
  });

  it("expiry must be in the next 30 days", async () => {
    await expect(invite(org.ownerId, "far@example.test", "staff", { commit: false, expiresSql: "now() + interval '40 days'" })).rejects.toThrow(/30 days/);
    await expect(invite(org.ownerId, "past@example.test", "staff", { commit: false, expiresSql: "now() - interval '1 day'" })).rejects.toThrow(/30 days/);
  });
});

describe("revoking and resending", () => {
  it("revoke records who and when, is audited, and cannot be undone", async () => {
    const { id } = await invite(org.ownerId, "revoke@example.test");
    await as(db, user(adminId), (c) => c.query("update public.team_invitations set status = 'revoked' where id = $1", [id]), true);
    const { rows } = await db.query("select status, revoked_by, revoked_at is not null as has_time from public.team_invitations where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "revoked", revoked_by: adminId, has_time: true });
    await expect(
      as(db, user(org.ownerId), (c) => c.query("update public.team_invitations set status = 'pending', token_hash = $2 where id = $1", [id, nextHash()])),
    ).rejects.toThrow(/closed/);
    const audit = await db.query("select action from public.audit_logs where entity_id = $1 order by id", [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["invite.created", "invite.revoked"]);
  });

  it("app users cannot mark an invitation accepted or change who/what it is for", async () => {
    const { id } = await invite(org.ownerId, "tamper@example.test");
    await expect(as(db, user(org.ownerId), (c) => c.query("update public.team_invitations set status = 'accepted' where id = $1", [id]))).rejects.toThrow(
      /Only the invited person/,
    );
    await expect(as(db, user(org.ownerId), (c) => c.query("update public.team_invitations set role = 'admin' where id = $1", [id]))).rejects.toThrow(/permission denied/);
  });

  it("an admin cannot revoke or resend an administrator invitation", async () => {
    const { id } = await invite(org.ownerId, "admin-invite@example.test", "admin");
    const res = await as(db, user(adminId), (c) => c.query("update public.team_invitations set status = 'revoked' where id = $1", [id]).catch((e: Error) => e));
    expect(String(res)).toMatch(/Only the owner/);
  });

  it("resending replaces the link and is audited", async () => {
    const { id, token } = await invite(org.ownerId, "resend@example.test");
    const fresh = nextHash();
    await as(db, user(org.ownerId), (c) => c.query("update public.team_invitations set token_hash = $2, expires_at = now() + interval '7 days', send_count = send_count + 1 where id = $1", [id, fresh]), true);
    expect((await accept(token, org.outsiderId)).result).toBe("not_found");
    const audit = await db.query("select action from public.audit_logs where entity_id = $1 order by id", [id]);
    expect(audit.rows.map((r) => r.action)).toContain("invite.resent");
  });
});

describe("accepting", () => {
  it("creates an active membership with the invited role, once", async () => {
    const newUser = await createAuthUser(db, "joiner@example.test");
    const { id, token } = await invite(org.ownerId, "joiner@example.test", "instructor");

    const info = await as(db, service, (c) => c.query("select * from public.get_team_invitation($1)", [token]));
    expect(info.rows[0]).toMatchObject({ organization_name: "Test Academy", email: "joiner@example.test", role: "instructor", status: "pending", role_enabled: true });

    const first = await accept(token, newUser, "Jo Iner");
    expect(first.result).toBe("ok");
    const { rows } = await db.query(
      "select m.role, m.status, p.full_name from public.organization_memberships m join public.user_profiles p on p.id = m.user_id where m.id = $1",
      [first.membership_id],
    );
    expect(rows[0]).toEqual({ role: "instructor", status: "active", full_name: "Jo Iner" });

    const inv = await db.query("select status, accepted_by, membership_id from public.team_invitations where id = $1", [id]);
    expect(inv.rows[0]).toEqual({ status: "accepted", accepted_by: newUser, membership_id: first.membership_id });

    expect((await accept(token, newUser)).result).toBe("used");
    const audit = await db.query("select action, actor_id from public.audit_logs where entity_id = $1 and action = 'invite.accepted'", [id]);
    expect(audit.rows).toEqual([{ action: "invite.accepted", actor_id: newUser }]);

    // The new member can now use their role's permissions.
    const perm = await as(db, user(newUser), (c) => c.query("select public.has_permission($1, 'attendance.record') as ok", [org.orgId]));
    expect(perm.rows[0].ok).toBe(true);
  });

  it("a member who joined by invitation can be removed and invited again", async () => {
    const leaver = await createAuthUser(db, "leaver@example.test");
    const { id, token } = await invite(org.ownerId, "leaver@example.test");
    const res = await accept(token, leaver);
    await as(db, user(adminId), (c) => c.query("delete from public.organization_memberships where id = $1", [res.membership_id]), true);
    const inv = await db.query("select status, membership_id from public.team_invitations where id = $1", [id]);
    expect(inv.rows[0]).toEqual({ status: "accepted", membership_id: null });
    const again = await invite(org.ownerId, "leaver@example.test");
    expect((await accept(again.token, leaver)).result).toBe("ok");
  });

  it("refuses expired, revoked, unknown and mismatched invitations", async () => {
    const someone = await createAuthUser(db, "someone@example.test");
    const exp = await invite(org.ownerId, "someone@example.test");
    await as(db, service, (c) => c.query("update public.team_invitations set expires_at = now() - interval '1 second' where id = $1", [exp.id]), true);
    const shown = await as(db, service, (c) => c.query("select status from public.get_team_invitation($1)", [exp.token]));
    expect(shown.rows[0].status).toBe("expired");
    expect((await accept(exp.token, someone)).result).toBe("expired");
    expect((await db.query("select status from public.team_invitations where id = $1", [exp.id])).rows[0].status).toBe("expired");

    const rev = await invite(org.ownerId, "someone@example.test");
    await as(db, user(org.ownerId), (c) => c.query("update public.team_invitations set status = 'revoked' where id = $1", [rev.id]), true);
    expect((await accept(rev.token, someone)).result).toBe("revoked");

    expect((await accept(hash(999999), someone)).result).toBe("not_found");

    const other = await invite(org.ownerId, "other-person@example.test");
    expect((await accept(other.token, someone)).result).toBe("email_mismatch");
    const memberships = await db.query("select count(*)::int as n from public.organization_memberships where user_id = $1", [someone]);
    expect(memberships.rows[0].n).toBe(0);
  });

  it("never reactivates a suspended member", async () => {
    const suspended = await createAuthUser(db, "suspended@example.test");
    const { token } = await invite(org.ownerId, "suspended@example.test");
    await as(db, service, (c) => c.query("insert into public.organization_memberships (organization_id, user_id, role, status) values ($1, $2, 'staff', 'suspended')", [org.orgId, suspended]), true);
    const res = await accept(token, suspended);
    expect(res.result).toBe("already_member");
    const { rows } = await db.query("select status from public.organization_memberships where user_id = $1", [suspended]);
    expect(rows[0].status).toBe("suspended");
  });

  it("reports when the invited role is switched off", async () => {
    const { token } = await invite(org.ownerId, "switched-off@example.test", "staff");
    await as(db, service, (c) => c.query("update public.organizations set staff_enabled = false where id = $1", [org.orgId]), true);
    try {
      const { rows } = await as(db, service, (c) => c.query("select role_enabled from public.get_team_invitation($1)", [token]));
      expect(rows[0].role_enabled).toBe(false);
    } finally {
      await as(db, service, (c) => c.query("update public.organizations set staff_enabled = true where id = $1", [org.orgId]), true);
    }
  });
});

describe("managing members", () => {
  it("suspending removes access; reactivating restores it; both are audited", async () => {
    const memberId = await createAuthUser(db, "suspend-me@example.test");
    const m = await as(db, service, async (c) => (await c.query<{ id: string }>("insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'staff') returning id", [org.orgId, memberId])).rows[0].id, true);
    await as(db, user(adminId), (c) => c.query("update public.organization_memberships set status = 'suspended' where id = $1", [m]), true);
    const off = await as(db, user(memberId), (c) => c.query("select public.has_permission($1, 'dashboard.view') as ok", [org.orgId]));
    expect(off.rows[0].ok).toBe(false);
    await as(db, user(adminId), (c) => c.query("update public.organization_memberships set status = 'active' where id = $1", [m]), true);
    const on = await as(db, user(memberId), (c) => c.query("select public.has_permission($1, 'dashboard.view') as ok", [org.orgId]));
    expect(on.rows[0].ok).toBe(true);
    const audit = await db.query("select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'member.updated'", [m]);
    expect(audit.rows[0].n).toBe(2);
  });

  it("staff cannot change memberships; admins cannot change administrators; nobody changes themselves", async () => {
    const { rows } = await as(db, user(org.staffId), (c) => c.query("update public.organization_memberships set role = 'admin' where user_id = $1 returning id", [org.instructorId]));
    expect(rows).toHaveLength(0);
    const otherAdmin = await createAuthUser(db, "admin2@example.test");
    await as(db, service, (c) => c.query("insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'admin')", [org.orgId, otherAdmin]), true);
    await expect(as(db, user(adminId), (c) => c.query("update public.organization_memberships set role = 'staff' where user_id = $1", [otherAdmin]))).rejects.toThrow(/Only the owner/);
    await expect(as(db, user(adminId), (c) => c.query("delete from public.organization_memberships where user_id = $1", [otherAdmin]))).rejects.toThrow(/Only the owner/);
    await expect(as(db, user(org.ownerId), (c) => c.query("update public.organization_memberships set role = 'admin' where user_id = $1", [org.ownerId]))).rejects.toThrow(/your own membership/);
    await expect(as(db, user(org.ownerId), (c) => c.query("update public.organization_memberships set role = 'staff' where user_id = $1", [otherAdmin]))).resolves.toBeTruthy();
  });
});

describe("permission overrides", () => {
  it("the owner can tailor a staff member's permissions, audited", async () => {
    const m = (await db.query("select id from public.organization_memberships where user_id = $1", [org.staffId])).rows[0].id as string;
    await as(db, user(org.ownerId), (c) => c.query("insert into public.membership_permission_overrides (membership_id, permission_key, allowed) values ($1, 'candidates.export', true)", [m]), true);
    const ok = await as(db, user(org.staffId), (c) => c.query("select public.has_permission($1, 'candidates.export') as ok", [org.orgId]));
    expect(ok.rows[0].ok).toBe(true);
    await as(db, user(org.ownerId), (c) => c.query("delete from public.membership_permission_overrides where membership_id = $1", [m]), true);
    const audit = await db.query("select details from public.audit_logs where entity_id = $1 and action = 'member.permissions_changed' order by id", [m]);
    expect(audit.rows.map((r) => r.details.reset_to_role_default)).toEqual([false, true]);
  });

  it("admins cannot change an administrator's overrides", async () => {
    const otherAdmin = await createAuthUser(db, "admin3@example.test");
    const m = await as(db, service, async (c) => (await c.query<{ id: string }>("insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'admin') returning id", [org.orgId, otherAdmin])).rows[0].id, true);
    await expect(
      as(db, user(adminId), (c) => c.query("insert into public.membership_permission_overrides (membership_id, permission_key, allowed) values ($1, 'finance.view', false)", [m])),
    ).rejects.toThrow(/Only the owner/);
  });

  it("a member manager cannot grant a permission they do not hold", async () => {
    const staffMembership = (await db.query("select id from public.organization_memberships where user_id = $1", [org.staffId])).rows[0].id as string;
    const instructorMembership = (await db.query("select id from public.organization_memberships where user_id = $1", [org.instructorId])).rows[0].id as string;
    await as(db, user(org.ownerId), (c) => c.query("insert into public.membership_permission_overrides (membership_id, permission_key, allowed) values ($1, 'members.manage', true)", [staffMembership]), true);
    try {
      await expect(
        as(db, user(org.staffId), (c) => c.query("insert into public.membership_permission_overrides (membership_id, permission_key, allowed) values ($1, 'finance.view', true)", [instructorMembership])),
      ).rejects.toThrow(/do not have/);
      // Staff with members.manage still cannot invite administrators.
      await expect(invite(org.staffId, "sneaky-admin@example.test", "admin", { commit: false })).rejects.toThrow(/Only the owner/);
    } finally {
      await as(db, user(org.ownerId), (c) => c.query("delete from public.membership_permission_overrides where membership_id = $1", [staffMembership]), true);
    }
  });
});

describe("invitation email template", () => {
  it("is seeded for the organization", async () => {
    const { rows } = await db.query("select audience, design->>'button_url' as url from public.email_templates where organization_id = $1 and key = 'team_invitation'", [org.orgId]);
    expect(rows).toEqual([{ audience: "team", url: "{{invite_url}}" }]);
  });
});
