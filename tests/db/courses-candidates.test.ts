import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let courseId: string;

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  courseId = await as(
    db,
    user(o.ownerId),
    async (c) => {
      const cat = await c.query("insert into public.course_categories (organization_id, name, slug) values ($1, 'Data', 'data') returning id", [o.orgId]);
      const { rows } = await c.query(
        `insert into public.courses (organization_id, category_id, title, slug, list_price, discounted_price, show_price, status)
         values ($1, $2, 'Synthetic Data Course', 'synthetic-data', 20000, 15000, false, 'published') returning id`,
        [o.orgId, cat.rows[0].id],
      );
      return rows[0].id as string;
    },
    true,
  );
});
afterAll(async () => drop?.());

const register = (values: Record<string, unknown>, slug = "synthetic-data") =>
  as(db, { role: "service_role" }, async (c) => (await c.query("select public.submit_registration($1, $2, $3, $4) as r", [slug, values, { goal: "x" }, { utm_source: "telegram", utm_campaign: "oct" }])).rows[0].r, true);

describe("course catalogue", () => {
  it("seeds default registration fields and lead statuses", async () => {
    const f = await db.query("select count(*)::int n from public.course_registration_fields where course_id = $1", [courseId]);
    const s = await db.query("select count(*)::int n from public.lead_statuses where organization_id = $1", [o.orgId]);
    expect(f.rows[0].n).toBeGreaterThanOrEqual(10);
    expect(s.rows[0].n).toBe(13);
  });

  it("exposes published courses publicly but hides prices when show_price is off", async () => {
    const { rows } = await as(db, { role: "anon" }, (c) => c.query("select public.get_public_course('synthetic-data') as c, public.get_public_courses() as l"));
    expect(rows[0].c.title).toBe("Synthetic Data Course");
    expect(rows[0].c.list_price).toBeNull();
    expect(rows[0].c.discounted_price).toBeNull();
    expect(rows[0].l).toHaveLength(1);
  });

  it("does not expose drafts and anon cannot read tables directly", async () => {
    await as(db, user(o.ownerId), (c) => c.query("insert into public.courses (organization_id, title, slug) values ($1, 'Hidden Draft', 'hidden-draft')", [o.orgId]), true);
    const { rows } = await as(db, { role: "anon" }, (c) => c.query("select public.get_public_course('hidden-draft') as c"));
    expect(rows[0].c).toBeNull();
    await expect(as(db, { role: "anon" }, (c) => c.query("select * from public.courses"))).rejects.toThrow(/permission denied/);
  });

  it("only course managers can create courses", async () => {
    await expect(
      as(db, user(o.staffId), (c) => c.query("insert into public.courses (organization_id, title, slug) values ($1, 'Staff Course', 'staff-course')", [o.orgId])),
    ).rejects.toThrow(/row-level security/);
    const read = await as(db, user(o.staffId), (c) => c.query("select id from public.courses"));
    expect(read.rowCount).toBeGreaterThan(0);
  });
});

describe("public registration", () => {
  it("creates a candidate, registration and timeline entry with attribution", async () => {
    const r = await register({ full_name: "Asha Example", email: "Asha@Example.TEST", phone: "+91 98765 43210", privacy_consent: true, marketing_consent: true });
    expect(r).toMatchObject({ is_new: true, duplicate: false });
    const { rows } = await db.query("select c.email_normalized, c.utm_source, s.key from public.candidates c join public.lead_statuses s on s.id = c.lead_status_id where c.id = $1", [r.candidate_id]);
    expect(rows[0]).toEqual({ email_normalized: "asha@example.test", utm_source: "telegram", key: "new" });
  });

  it("links a repeat registration to the same candidate without overwriting data", async () => {
    const r = await register({ full_name: "Different Name", email: "asha@example.test", phone: "09876543210", privacy_consent: true });
    expect(r).toMatchObject({ is_new: false, duplicate: true });
    const { rows } = await db.query("select full_name from public.candidates where id = $1", [r.candidate_id]);
    expect(rows[0].full_name).toBe("Asha Example");
    const regs = await db.query("select count(*)::int n, count(duplicate_reason)::int d from public.course_registrations where candidate_id = $1", [r.candidate_id]);
    expect(regs.rows[0]).toEqual({ n: 2, d: 1 });
  });

  it("matches by phone when the email differs", async () => {
    const r = await register({ full_name: "Phone Match", email: "other@example.test", phone: "9876543210", privacy_consent: true });
    expect(r.duplicate).toBe(true);
  });

  it("rejects unknown or draft courses", async () => {
    await expect(register({ full_name: "X", email: "x@example.test" }, "hidden-draft")).rejects.toThrow(/Course not found/);
  });

  it("cannot be called by anon or members directly", async () => {
    for (const who of [{ role: "anon" as const }, user(o.ownerId)]) {
      await expect(as(db, who, (c) => c.query("select public.submit_registration('synthetic-data', '{}'::jsonb, '{}'::jsonb)"))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("candidate visibility", () => {
  it("staff only see candidates assigned to them", async () => {
    const before = await as(db, user(o.staffId), (c) => c.query("select id from public.candidates"));
    expect(before.rowCount).toBe(0);
    const cid = (await db.query("select id from public.candidates limit 1")).rows[0].id;
    await as(db, user(o.ownerId), (c) => c.query("update public.candidates set owner_id = $1 where id = $2", [o.staffId, cid]), true);
    const after = await as(db, user(o.staffId), (c) => c.query("select id from public.candidates"));
    expect(after.rows.map((r) => r.id)).toEqual([cid]);
  });

  it("instructors and outsiders see no candidates", async () => {
    for (const id of [o.instructorId, o.outsiderId]) {
      const r = await as(db, user(id), (c) => c.query("select id from public.candidates"));
      expect(r.rowCount).toBe(0);
    }
  });

  it("records status changes with who and when, and notes on the timeline", async () => {
    const cid = (await db.query("select id from public.candidates order by created_at limit 1")).rows[0].id;
    await as(
      db,
      user(o.ownerId),
      async (c) => {
        await c.query("update public.candidates set lead_status_id = (select id from public.lead_statuses where key = 'contacted') where id = $1", [cid]);
        await c.query("insert into public.candidate_notes (organization_id, candidate_id, body, author_id) values ($1, $2, 'Called, interested', $3)", [o.orgId, cid, o.ownerId]);
        await c.query("insert into public.follow_up_tasks (organization_id, candidate_id, title, due_at, assigned_to) values ($1, $2, 'Send demo', now() - interval '1 day', $3)", [o.orgId, cid, o.ownerId]);
      },
      true,
    );
    const h = await db.query("select changed_by from public.lead_status_history where candidate_id = $1 and from_status_id is not null", [cid]);
    expect(h.rows[0].changed_by).toBe(o.ownerId);
    const a = await db.query("select type from public.candidate_activities where candidate_id = $1 order by id", [cid]);
    expect(a.rows.map((r) => r.type)).toEqual(expect.arrayContaining(["registered", "status_changed", "note_added", "follow_up_created"]));
  });

  it("staff cannot reassign a candidate away to hide it or take unassigned ones", async () => {
    const unassigned = (await register({ full_name: "Unassigned Person", email: "unassigned@example.test", privacy_consent: true })).candidate_id;
    const r = await as(db, user(o.staffId), (c) => c.query("update public.candidates set owner_id = $1 where id = $2", [o.staffId, unassigned]));
    expect(r.rowCount).toBe(0);
  });
});
