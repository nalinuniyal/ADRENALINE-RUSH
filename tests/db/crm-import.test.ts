import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let existingId: string;

const importAs = (userId: string, rows: unknown[], owner: string | null = null, fileName = "leads.csv", commit = true) =>
  as(
    db,
    user(userId),
    async (c) => (await c.query("select public.import_candidates($1, $2::jsonb, $3, $4) as r", [o.orgId, JSON.stringify(rows), owner, fileName])).rows[0].r,
    commit,
  );

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  await as(
    db,
    user(o.ownerId),
    (c) => c.query("insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic Import Course', 'import-course', 'published')", [o.orgId]),
    true,
  );
  existingId = await as(
    db,
    user(o.ownerId),
    async (c) =>
      (await c.query("insert into public.candidates (organization_id, full_name, email, phone) values ($1, 'Existing Person', 'existing@example.test', '+91 90000 00001') returning id", [o.orgId]))
        .rows[0].id as string,
    true,
  );
});
afterAll(async () => drop?.());

describe("import_candidates permissions", () => {
  it("is refused for members without candidates.import and for outsiders", async () => {
    for (const id of [o.staffId, o.instructorId, o.outsiderId]) {
      await expect(importAs(id, [{ full_name: "X", email: "x@example.test" }], null, "f.csv", false)).rejects.toThrow(/permission to import/);
    }
  });

  it("cannot be executed by anon", async () => {
    await expect(
      as(db, { role: "anon" }, (c) => c.query("select public.import_candidates($1, '[]'::jsonb)", [o.orgId])),
    ).rejects.toThrow(/permission denied/);
  });

  it("rejects more than 5000 rows and non-array input", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({ full_name: `P${i}`, email: `p${i}@example.test` }));
    await expect(importAs(o.ownerId, many, null, "big.csv", false)).rejects.toThrow(/Too many rows/);
    await expect(
      as(db, user(o.ownerId), (c) => c.query("select public.import_candidates($1, '{}'::jsonb)", [o.orgId])),
    ).rejects.toThrow(/JSON array/);
  });
});

describe("import_candidates", () => {
  it("creates, dedupes and reports invalid rows with accurate counts", async () => {
    const r = await importAs(o.ownerId, [
      { full_name: "Import One", email: "One@Example.test", phone: "+91 91111 11111", lead_status: "Interested", course_slug: "IMPORT-COURSE", notes: "Met at a meetup", utm_source: "linkedin" },
      { full_name: "Import One Again", email: "one@example.test" },
      { full_name: "Phone Twin", phone: "09111111111" },
      { full_name: "Matches Existing", email: "EXISTING@example.test" },
      { full_name: "Existing By Phone", phone: "9000000001" },
      { full_name: "", email: "noname@example.test" },
      { full_name: "No Contact" },
      { full_name: "Bad Email", email: "not-an-email" },
      { full_name: "Bad Status", email: "status@example.test", lead_status: "nope" },
      { full_name: "Bad Course", email: "course@example.test", course_slug: "missing" },
      { full_name: "x".repeat(200), email: "long@example.test" },
      { full_name: "Import Two", phone: "+1 555 010 0002", company: "Synthetic Co" },
    ]);
    expect(r).toMatchObject({ created: 2, duplicates: 4, invalid: 6 });
    const byRow = new Map<number, { status: string; reason?: string; candidate_id?: string }>(r.results.map((x: { row: number }) => [x.row, x]));
    expect(byRow.get(2)).toMatchObject({ status: "duplicate", reason: "Duplicate of an earlier row in this file" });
    expect(byRow.get(3)?.reason).toBe("Duplicate of an earlier row in this file");
    expect(byRow.get(4)).toMatchObject({ status: "duplicate", reason: "Matches an existing candidate", candidate_id: existingId });
    expect(byRow.get(9)?.reason).toBe("Unknown lead status");
    expect(byRow.get(10)?.reason).toBe("Unknown course");
    expect(byRow.get(11)).toMatchObject({ status: "invalid", reason: "A value is too long or not allowed" });

    const one = byRow.get(1)!.candidate_id!;
    const { rows } = await db.query(
      `select c.source, c.utm_source, c.created_by, c.privacy_consent_at, c.marketing_consent, s.key as status,
              (select count(*)::int from public.course_registrations r where r.candidate_id = c.id and r.channel = 'import') as regs,
              (select count(*)::int from public.candidate_notes n where n.candidate_id = c.id) as notes,
              (select count(*)::int from public.candidate_activities a where a.candidate_id = c.id and a.type = 'imported') as imported
         from public.candidates c join public.lead_statuses s on s.id = c.lead_status_id where c.id = $1`,
      [one],
    );
    expect(rows[0]).toEqual({
      source: "import",
      utm_source: "linkedin",
      created_by: o.ownerId,
      privacy_consent_at: null,
      marketing_consent: false,
      status: "interested",
      regs: 1,
      notes: 1,
      imported: 1,
    });

    const audit = await db.query("select details from public.audit_logs where action = 'candidates.import' order by id desc limit 1");
    expect(audit.rows[0].details).toMatchObject({ rows: 12, created: 2, duplicates: 4, invalid: 6 });
  });

  it("re-importing the same file creates nothing", async () => {
    const r = await importAs(o.ownerId, [{ full_name: "Import One", email: "one@example.test" }, { full_name: "Import Two", phone: "5550100002" }]);
    expect(r).toMatchObject({ created: 0, duplicates: 2, invalid: 0 });
  });

  it("assigns an owner and refuses owners who are not members", async () => {
    const r = await importAs(o.ownerId, [{ full_name: "Owned Import", email: "owned@example.test" }], o.staffId);
    const { rows } = await db.query("select owner_id from public.candidates where id = $1", [r.results[0].candidate_id]);
    expect(rows[0].owner_id).toBe(o.staffId);
    await expect(importAs(o.ownerId, [{ full_name: "Y", email: "y@example.test" }], o.outsiderId, "f.csv", false)).rejects.toThrow(/active member/);
  });

  it("staff granted import own what they import and do not learn about hidden duplicates", async () => {
    await as(
      db,
      { role: "service_role" },
      (c) =>
        c.query(
          `insert into public.membership_permission_overrides (membership_id, permission_key, allowed)
           select id, 'candidates.import', true from public.organization_memberships where user_id = $1`,
          [o.staffId],
        ),
      true,
    );
    const r = await importAs(o.staffId, [
      { full_name: "Staff Import", email: "staffimport@example.test" },
      { full_name: "Hidden Dup", email: "existing@example.test" },
    ], o.ownerId);
    expect(r).toMatchObject({ created: 1, duplicates: 1 });
    expect(r.results[1].candidate_id).toBeNull();
    const { rows } = await db.query("select owner_id from public.candidates where id = $1", [r.results[0].candidate_id]);
    expect(rows[0].owner_id).toBe(o.staffId);
  });
});

describe("duplicate lookups", () => {
  it("find_candidate_duplicates hides names of records the caller cannot see", async () => {
    const asOwner = await as(db, user(o.ownerId), (c) => c.query("select * from public.find_candidate_duplicates($1, 'Existing@example.test', '', null)", [o.orgId]));
    expect(asOwner.rows).toEqual([{ candidate_id: existingId, matched_on: "email", can_view: true, full_name: "Existing Person" }]);
    const asStaff = await as(db, user(o.staffId), (c) => c.query("select * from public.find_candidate_duplicates($1, '', '+91 90000 00001', null)", [o.orgId]));
    expect(asStaff.rows).toEqual([{ candidate_id: existingId, matched_on: "phone", can_view: false, full_name: null }]);
    const excluded = await as(db, user(o.ownerId), (c) => c.query("select * from public.find_candidate_duplicates($1, 'existing@example.test', '', $2)", [o.orgId, existingId]));
    expect(excluded.rowCount).toBe(0);
    await expect(
      as(db, user(o.instructorId), (c) => c.query("select * from public.find_candidate_duplicates($1, 'existing@example.test', '', null)", [o.orgId])),
    ).rejects.toThrow(/Not allowed/);
  });

  it("find_existing_candidate_keys returns only matching keys and needs import permission", async () => {
    const r = await as(db, user(o.ownerId), (c) =>
      c.query("select * from public.find_existing_candidate_keys($1, $2, $3) order by kind, key", [o.orgId, ["existing@example.test", "nobody@example.test"], ["9000000001", "1234567890"]]),
    );
    expect(r.rows).toEqual([
      { kind: "email", key: "existing@example.test" },
      { kind: "phone", key: "9000000001" },
    ]);
    await expect(
      as(db, user(o.instructorId), (c) => c.query("select * from public.find_existing_candidate_keys($1, '{}', '{}')", [o.orgId])),
    ).rejects.toThrow(/Not allowed/);
  });
});

describe("owners and integrity rules", () => {
  it("list_candidate_owners lists members with candidates.manage only", async () => {
    const r = await as(db, user(o.staffId), (c) => c.query("select user_id from public.list_candidate_owners($1)", [o.orgId]));
    expect(r.rows.map((x) => x.user_id).sort()).toEqual([o.ownerId, o.staffId].sort());
    const outsider = await as(db, user(o.outsiderId), (c) => c.query("select user_id from public.list_candidate_owners($1)", [o.orgId]));
    expect(outsider.rowCount).toBe(0);
  });

  it("candidates can only be owned by active members", async () => {
    await expect(
      as(db, user(o.ownerId), (c) => c.query("update public.candidates set owner_id = $1 where id = $2", [o.outsiderId, existingId])),
    ).rejects.toThrow(/active member/);
  });

  it("keeps last_activity_at fresh from the timeline", async () => {
    const before = (await db.query("select last_activity_at from public.candidates where id = $1", [existingId])).rows[0].last_activity_at as Date;
    await as(
      db,
      user(o.ownerId),
      (c) => c.query("insert into public.candidate_notes (organization_id, candidate_id, body, author_id) values ($1, $2, 'Called', $3)", [o.orgId, existingId, o.ownerId]),
      true,
    );
    const after = (await db.query("select last_activity_at from public.candidates where id = $1", [existingId])).rows[0].last_activity_at as Date;
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("lead statuses in use and the default status cannot be deleted; unused ones can", async () => {
    await expect(
      as(db, user(o.ownerId), (c) => c.query("delete from public.lead_statuses where organization_id = $1 and key = 'interested'", [o.orgId])),
    ).rejects.toThrow(/in use/);
    await expect(
      as(db, user(o.ownerId), (c) => c.query("delete from public.lead_statuses where organization_id = $1 and key = 'new'", [o.orgId])),
    ).rejects.toThrow(/cannot be deleted/);
    const r = await as(db, user(o.ownerId), (c) => c.query("delete from public.lead_statuses where organization_id = $1 and key = 'nurture'", [o.orgId]));
    expect(r.rowCount).toBe(1);
    const staff = await as(db, user(o.staffId), (c) => c.query("delete from public.lead_statuses where organization_id = $1 and key = 'nurture'", [o.orgId]));
    expect(staff.rowCount).toBe(0);
  });
});
