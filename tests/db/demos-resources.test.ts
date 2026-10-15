import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let publishedCourse: string;
let draftCourse: string;
let shareable: string;
let internal: string;
let inactive: string;
let expired: string;
let assignedCandidate: string;
let otherCandidate: string;

const svc = { role: "service_role" as const };
const anon = { role: "anon" as const };

async function insertResource(c: Client, values: { title: string; slug: string; visibility?: string; active?: boolean; expires?: string | null }) {
  const { rows } = await c.query(
    `insert into public.resources (organization_id, title, slug, type, url, visibility, is_active, expires_on)
     values ($1, $2, $3, 'demo_video', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', $4, $5, $6) returning id`,
    [o.orgId, values.title, values.slug, values.visibility ?? "shareable", values.active ?? true, values.expires ?? null],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  await as(
    db,
    user(o.ownerId),
    async (c) => {
      publishedCourse = (await c.query("insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic Published Course', 'pub-course', 'published') returning id", [o.orgId])).rows[0].id;
      draftCourse = (await c.query("insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic Draft Course', 'draft-course', 'draft') returning id", [o.orgId])).rows[0].id;
      shareable = await insertResource(c, { title: "Demo video", slug: "demo-video-abc123" });
      internal = await insertResource(c, { title: "Trainer notes", slug: "trainer-notes-abc123", visibility: "internal" });
      inactive = await insertResource(c, { title: "Old demo", slug: "old-demo-abc123", active: false });
      expired = await insertResource(c, { title: "Expired demo", slug: "expired-demo-abc123", expires: "2020-01-01" });
      await c.query("insert into public.resource_courses (resource_id, course_id) values ($1, $2), ($1, $3)", [shareable, publishedCourse, draftCourse]);
    },
    true,
  );
  [assignedCandidate, otherCandidate] = await as(
    db,
    svc,
    async (c) => {
      const a = await c.query("insert into public.candidates (organization_id, full_name, phone, owner_id) values ($1, 'Assigned Person', '+91 90000 00001', $2) returning id", [o.orgId, o.staffId]);
      const b = await c.query("insert into public.candidates (organization_id, full_name, email) values ($1, 'Other Person', 'other@example.test') returning id", [o.orgId]);
      return [a.rows[0].id as string, b.rows[0].id as string];
    },
    true,
  );
});
afterAll(async () => drop?.());

const share = (c: Client, values: { candidate?: string | null; resources?: string[]; method?: string; status?: string; sharedBy: string; template?: string | null }) =>
  c.query(
    `insert into public.resource_shares (organization_id, candidate_id, resource_ids, method, status, template_id, recipient, message, shared_by)
     values ($1, $2, $3, $4, $5, $6, '919000000001', 'Hi there', $7) returning id, resource_titles, template_name`,
    [o.orgId, values.candidate ?? null, values.resources ?? [shareable], values.method ?? "whatsapp", values.status ?? "opened", values.template ?? null, values.sharedBy],
  );

describe("defaults", () => {
  it("seeds sharing settings (+91) and three message templates", async () => {
    const { rows: s } = await db.query("select whatsapp_country_code from public.sharing_settings where organization_id = $1", [o.orgId]);
    expect(s).toEqual([{ whatsapp_country_code: "91" }]);
    const { rows: t } = await db.query("select key, channel from public.share_templates where organization_id = $1 order by position", [o.orgId]);
    expect(t.map((r) => r.key)).toEqual(["demo_whatsapp", "resources_email", "after_demo_follow_up"]);
  });

  it("does not recreate templates the owner deleted when setup is re-run", async () => {
    await as(db, svc, async (c) => {
      await c.query("delete from public.share_templates where organization_id = $1", [o.orgId]);
      await c.query("select public.seed_sharing_defaults($1)", [o.orgId]);
      expect((await c.query("select count(*)::int n from public.share_templates where organization_id = $1", [o.orgId])).rows[0].n).toBe(0);
    });
  });

  it("seed function is not callable by app users", async () => {
    await expect(as(db, user(o.ownerId), (c) => c.query("select public.seed_sharing_defaults($1)", [o.orgId]))).rejects.toThrow(/permission denied/);
  });
});

describe("resources RLS", () => {
  it("instructors (resources.manage) can create and edit resources", async () => {
    await as(db, user(o.instructorId), async (c) => {
      const id = await insertResource(c, { title: "Instructor upload", slug: "instructor-upload-x1" });
      const upd = await c.query("update public.resources set title = 'Renamed' where id = $1 returning id", [id]);
      expect(upd.rows).toHaveLength(1);
    });
  });

  it("staff (view + share only) can read but not change resources or templates", async () => {
    await as(db, user(o.staffId), async (c) => {
      expect((await c.query("select id from public.resources")).rows.length).toBe(4);
      expect((await c.query("update public.resources set title = 'Hacked' returning id")).rows).toHaveLength(0);
      expect((await c.query("delete from public.resources returning id")).rows).toHaveLength(0);
      expect((await c.query("update public.share_templates set name = 'Hacked' returning id")).rows).toHaveLength(0);
    });
    await expect(as(db, user(o.staffId), (c) => insertResource(c, { title: "Staff upload", slug: "staff-upload-x1" }))).rejects.toThrow(/row-level security/);
  });

  it("outsiders see nothing", async () => {
    await as(db, user(o.outsiderId), async (c) => {
      expect((await c.query("select id from public.resources")).rows).toHaveLength(0);
      expect((await c.query("select id from public.share_templates")).rows).toHaveLength(0);
      expect((await c.query("select id from public.resource_shares")).rows).toHaveLength(0);
      expect((await c.query("select organization_id from public.sharing_settings")).rows).toHaveLength(0);
    });
  });

  it("rejects bad data and courses from another organization", async () => {
    await expect(as(db, user(o.ownerId), (c) => c.query("update public.resources set url = 'javascript:alert(1)' where id = $1", [shareable]))).rejects.toThrow(/check constraint/);
    await expect(as(db, user(o.ownerId), (c) => c.query("update public.resources set url = 'http://insecure.example' where id = $1", [shareable]))).rejects.toThrow(/check constraint/);
    const otherOrg = (await db.query("insert into public.organizations (name, slug) values ('Other Academy', 'other-academy') returning id")).rows[0].id;
    const otherCourse = (await db.query("insert into public.courses (organization_id, title, slug) values ($1, 'Other course', 'other-course') returning id", [otherOrg])).rows[0].id;
    await expect(
      as(db, user(o.ownerId), (c) => c.query("insert into public.resource_courses (resource_id, course_id) values ($1, $2)", [shareable, otherCourse])),
    ).rejects.toThrow(/another organization|row-level security/);
  });
});

describe("sharing", () => {
  it("an instructor without resources.share cannot record a share", async () => {
    await expect(as(db, user(o.instructorId), (c) => share(c, { sharedBy: o.instructorId }))).rejects.toThrow(/row-level security/);
  });

  it("staff share with their assigned candidate; the timeline gets an activity", async () => {
    await as(
      db,
      user(o.staffId),
      async (c) => {
        const { rows } = await share(c, { candidate: assignedCandidate, sharedBy: o.staffId });
        expect(rows[0].resource_titles).toEqual(["Demo video"]);
        const act = await c.query("select type, summary, actor_id from public.candidate_activities where candidate_id = $1 and type = 'resource_shared'", [assignedCandidate]);
        expect(act.rows).toEqual([{ type: "resource_shared", summary: "WhatsApp opened to share: Demo video", actor_id: o.staffId }]);
      },
      true,
    );
  });

  it("staff cannot share with a candidate they cannot see, or as someone else", async () => {
    await expect(as(db, user(o.staffId), (c) => share(c, { candidate: otherCandidate, sharedBy: o.staffId }))).rejects.toThrow(/row-level security/);
    await expect(as(db, user(o.staffId), (c) => share(c, { candidate: assignedCandidate, sharedBy: o.ownerId }))).rejects.toThrow(/row-level security/);
  });

  it("only active, shareable, unexpired resources can be shared", async () => {
    for (const r of [internal, inactive, expired]) {
      await expect(as(db, user(o.ownerId), (c) => share(c, { resources: [shareable, r], sharedBy: o.ownerId }))).rejects.toThrow(/shareable/);
    }
    await expect(as(db, user(o.ownerId), (c) => share(c, { resources: [shareable, shareable], sharedBy: o.ownerId }))).rejects.toThrow(/shareable/);
  });

  it("statuses stay honest: WhatsApp and copies are never 'sent'", async () => {
    await expect(as(db, user(o.ownerId), (c) => share(c, { method: "whatsapp", status: "sent", sharedBy: o.ownerId }))).rejects.toThrow(/check constraint/);
    await expect(as(db, user(o.ownerId), (c) => share(c, { method: "copy_message", status: "sent", sharedBy: o.ownerId }))).rejects.toThrow(/check constraint/);
    await as(db, user(o.ownerId), async (c) => {
      const { rows } = await share(c, { candidate: otherCandidate, method: "email", status: "not_sent", sharedBy: o.ownerId });
      expect(rows).toHaveLength(1);
      const act = await c.query("select summary from public.candidate_activities where candidate_id = $1 and type = 'resource_shared'", [otherCandidate]);
      expect(act.rows[0].summary).toBe("Email not sent: Demo video");
    });
  });

  it("fills the template name from the database", async () => {
    await as(db, user(o.ownerId), async (c) => {
      const t = (await c.query("insert into public.share_templates (organization_id, name, body) values ($1, 'My template', 'Hi {{first_name}}') returning id", [o.orgId])).rows[0].id;
      const { rows } = await share(c, { method: "copy_message", status: "copied", template: t, sharedBy: o.ownerId });
      expect(rows[0].template_name).toBe("My template");
    });
  });

  it("shares are append-only and hidden for candidates the viewer cannot see", async () => {
    await as(db, user(o.ownerId), (c) => share(c, { candidate: otherCandidate, method: "copy_link", status: "copied", sharedBy: o.ownerId }), true);
    await as(db, user(o.staffId), async (c) => {
      const { rows } = await c.query("select candidate_id from public.resource_shares");
      expect(rows.map((r) => r.candidate_id)).toEqual([assignedCandidate]);
      const counts = await c.query("select resource_id, shares::int from public.resource_share_counts($1)", [o.orgId]);
      expect(counts.rows).toEqual([{ resource_id: shareable, shares: 1 }]);
    });
    await expect(as(db, user(o.staffId), (c) => c.query("update public.resource_shares set status = 'sent'"))).rejects.toThrow(/permission denied/);
    await expect(as(db, user(o.ownerId), (c) => c.query("delete from public.resource_shares"))).rejects.toThrow(/permission denied/);
    const owner = await as(db, user(o.ownerId), (c) => c.query("select shares::int from public.resource_share_counts($1)", [o.orgId]));
    expect(owner.rows[0].shares).toBe(2);
  });

  it("only settings managers change the WhatsApp country code", async () => {
    await as(db, user(o.staffId), async (c) => {
      expect((await c.query("select whatsapp_country_code from public.sharing_settings")).rows).toHaveLength(1);
      expect((await c.query("update public.sharing_settings set whatsapp_country_code = '44' returning 1")).rows).toHaveLength(0);
    });
    await as(db, user(o.ownerId), async (c) => {
      expect((await c.query("update public.sharing_settings set whatsapp_country_code = '44' returning 1")).rows).toHaveLength(1);
      await expect(c.query("update public.sharing_settings set whatsapp_country_code = '+44'")).rejects.toThrow(/check constraint/);
    });
  });

  it("email_log accepts share emails", async () => {
    await as(db, svc, (c) => c.query("insert into public.email_log (organization_id, kind, subject, status) values ($1, 'share', 'Resources', 'not_sent')", [o.orgId]));
  });
});

describe("anonymous visitors", () => {
  it("cannot read any resource table", async () => {
    for (const t of ["resources", "resource_courses", "share_templates", "sharing_settings", "resource_shares"]) {
      await expect(as(db, anon, (c) => c.query(`select * from public.${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, anon, (c) => c.query("select * from public.resource_share_counts($1)", [o.orgId]))).rejects.toThrow(/permission denied/);
  });

  it("read only shareable, active, unexpired resources through get_public_resource, with published courses", async () => {
    const get = (slug: string) => as(db, anon, async (c) => (await c.query("select public.get_public_resource($1) as r", [slug])).rows[0].r);
    const r = await get("demo-video-abc123");
    expect(r).toMatchObject({ title: "Demo video", type: "demo_video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", organization_name: "Test Academy" });
    expect(r.courses.map((c: { slug: string }) => c.slug)).toEqual(["pub-course"]);
    expect(Object.keys(r)).not.toContain("id");
    for (const slug of ["trainer-notes-abc123", "old-demo-abc123", "expired-demo-abc123", "missing"]) {
      expect(await get(slug)).toBeNull();
    }
  });
});
