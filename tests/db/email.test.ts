import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let courseId: string;
let assignedCandidate: string;
let otherCandidate: string;

const svc = { role: "service_role" as const };
const PNG_HEX = "\\x89504e470d0a1a0a0000000d49484452";

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  courseId = await as(
    db,
    user(o.ownerId),
    async (c) => (await c.query("insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic Email Course', 'email-course', 'published') returning id", [o.orgId])).rows[0].id as string,
    true,
  );
  [assignedCandidate, otherCandidate] = await as(
    db,
    svc,
    async (c) => {
      const a = await c.query("insert into public.candidates (organization_id, full_name, email, owner_id) values ($1, 'Assigned Person', 'assigned@example.test', $2) returning id", [o.orgId, o.staffId]);
      const b = await c.query("insert into public.candidates (organization_id, full_name, email) values ($1, 'Other Person', 'other@example.test') returning id", [o.orgId]);
      await c.query(
        `insert into public.email_log (organization_id, kind, candidate_id, to_address, subject, status, error) values
           ($1, 'automation', $2, 'assigned@example.test', 'To assigned', 'not_sent', 'No email provider configured'),
           ($1, 'automation', $3, 'other@example.test', 'To other', 'sent', null),
           ($1, 'test', null, 'owner@example.test', 'Test', 'failed', 'Timed out')`,
        [o.orgId, a.rows[0].id, b.rows[0].id],
      );
      return [a.rows[0].id as string, b.rows[0].id as string];
    },
    true,
  );
});
afterAll(async () => drop?.());

describe("email defaults", () => {
  it("seeds settings with the owner's address, two templates and two active demo automations", async () => {
    const { rows: settings } = await db.query("select admin_recipients from public.email_settings where organization_id = $1", [o.orgId]);
    expect(settings[0].admin_recipients).toEqual(["owner@example.test"]);
    const { rows: templates } = await db.query("select key, audience from public.email_templates where organization_id = $1 order by key", [o.orgId]);
    expect(templates).toEqual([
      { key: "demo_booking_team", audience: "team" },
      { key: "demo_confirmation_candidate", audience: "candidate" },
    ]);
    const { rows: autos } = await db.query(
      "select a.recipient, a.channel, a.course_id, a.is_active, t.key from public.email_automations a join public.email_templates t on t.id = a.template_id where a.organization_id = $1 order by a.recipient",
      [o.orgId],
    );
    expect(autos).toEqual([
      { recipient: "admins", channel: "demo_request", course_id: null, is_active: true, key: "demo_booking_team" },
      { recipient: "candidate", channel: "demo_request", course_id: null, is_active: true, key: "demo_confirmation_candidate" },
    ]);
  });

  it("does not recreate defaults the owner removed when setup is re-run", async () => {
    await as(db, svc, async (c) => {
      await c.query("delete from public.email_automations where organization_id = $1", [o.orgId]);
      await c.query("select public.seed_email_defaults($1)", [o.orgId]);
      const { rows } = await c.query("select count(*)::int n from public.email_automations where organization_id = $1", [o.orgId]);
      expect(rows[0].n).toBe(0);
    });
  });

  it("is not callable by app users", async () => {
    await expect(as(db, user(o.ownerId), (c) => c.query("select public.seed_email_defaults($1)", [o.orgId]))).rejects.toThrow(/permission denied/);
  });
});

describe("templates, automations and settings RLS", () => {
  it("owner manages templates and automations", async () => {
    await as(db, user(o.ownerId), async (c) => {
      const t = await c.query("insert into public.email_templates (organization_id, name, subject) values ($1, 'Custom', 'Hi') returning id", [o.orgId]);
      const a = await c.query(
        "insert into public.email_automations (organization_id, name, course_id, channel, recipient, custom_emails, template_id) values ($1, 'Course rule', $2, 'any', 'custom', '{a@example.test}', $3) returning id",
        [o.orgId, courseId, t.rows[0].id],
      );
      expect(a.rows).toHaveLength(1);
      await c.query("update public.email_settings set admin_recipients = '{x@example.test,y@example.test}' where organization_id = $1", [o.orgId]);
      // A template used by an automation cannot be deleted.
      await expect(c.query("delete from public.email_templates where id = $1", [t.rows[0].id])).rejects.toThrow(/foreign key/);
    });
  });

  it("enforces data rules", async () => {
    const t = (await db.query("select id from public.email_templates where organization_id = $1 limit 1", [o.orgId])).rows[0].id;
    const fails = (sql: string, params: unknown[]) => expect(as(db, user(o.ownerId), (c) => c.query(sql, params))).rejects.toThrow(/check constraint/);
    await fails("insert into public.email_automations (organization_id, name, recipient, template_id) values ($1, 'No list', 'custom', $2)", [o.orgId, t]);
    await fails("update public.email_settings set admin_recipients = '{not-an-email}' where organization_id = $1", [o.orgId]);
    await fails("update public.email_templates set use_custom_html = true, custom_html = null where id = $1", [t]);
  });

  it("keeps templates and courses in the automation's organization", async () => {
    const otherOrg = (await db.query("insert into public.organizations (name, slug) values ('Other Academy', 'other-academy') returning id")).rows[0].id;
    const otherTpl = (await db.query("select id from public.email_templates where organization_id = $1 limit 1", [otherOrg])).rows[0].id;
    expect(otherTpl).toBeTruthy();
    await expect(
      as(db, user(o.ownerId), (c) =>
        c.query("insert into public.email_automations (organization_id, name, recipient, template_id) values ($1, 'Cross org', 'candidate', $2)", [o.orgId, otherTpl]),
      ),
    ).rejects.toThrow(/another organization/);
    // And the owner cannot see the other organization's templates at all.
    const { rows } = await as(db, user(o.ownerId), (c) => c.query("select id from public.email_templates where organization_id = $1", [otherOrg]));
    expect(rows).toHaveLength(0);
  });

  it("staff with marketing.view can read but not change", async () => {
    await as(db, user(o.staffId), async (c) => {
      expect((await c.query("select id from public.email_templates")).rows.length).toBeGreaterThan(0);
      expect((await c.query("select organization_id from public.email_settings")).rows).toHaveLength(1);
      const upd = await c.query("update public.email_templates set subject = 'Hacked' returning id");
      expect(upd.rows).toHaveLength(0);
      const s = await c.query("update public.email_settings set admin_recipients = '{evil@example.test}' returning organization_id");
      expect(s.rows).toHaveLength(0);
      await expect(c.query("insert into public.email_templates (organization_id, name, subject) values ($1, 'Nope', 'x')", [o.orgId])).rejects.toThrow(/row-level security/);
    });
  });

  it("members without marketing access and outsiders see nothing", async () => {
    for (const id of [o.instructorId, o.outsiderId]) {
      await as(db, user(id), async (c) => {
        for (const t of ["email_templates", "email_automations", "email_settings", "email_log"]) {
          expect((await c.query(`select * from public.${t}`)).rows).toHaveLength(0);
        }
      });
    }
  });

  it("anon has no access to any email table", async () => {
    for (const t of ["email_templates", "email_automations", "email_settings", "email_log", "media_assets"]) {
      await expect(as(db, { role: "anon" }, (c) => c.query(`select 1 from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("email_log", () => {
  it("owner reads every row", async () => {
    const { rows } = await as(db, user(o.ownerId), (c) => c.query("select subject from public.email_log order by subject"));
    expect(rows.map((r) => r.subject)).toEqual(["Test", "To assigned", "To other"]);
  });

  it("staff only see rows about candidates they can see", async () => {
    const { rows } = await as(db, user(o.staffId), (c) => c.query("select subject, candidate_id from public.email_log order by subject"));
    expect(rows.map((r) => r.subject)).toEqual(["Test", "To assigned"]);
    expect(rows.some((r) => r.candidate_id === otherCandidate)).toBe(false);
    expect(rows.some((r) => r.candidate_id === assignedCandidate)).toBe(true);
  });

  it("is append-only for app users (written by the server only)", async () => {
    await as(db, user(o.ownerId), async (c) => {
      await expect(c.query("insert into public.email_log (organization_id, subject, status) values ($1, 'x', 'sent')", [o.orgId])).rejects.toThrow(/permission denied/);
    });
    await expect(as(db, user(o.ownerId), (c) => c.query("update public.email_log set status = 'sent'"))).rejects.toThrow(/permission denied/);
    await expect(as(db, user(o.ownerId), (c) => c.query("delete from public.email_log"))).rejects.toThrow(/permission denied/);
  });

  it("is removed with the candidate it is about", async () => {
    await as(db, svc, async (c) => {
      await c.query("delete from public.candidates where id = $1", [otherCandidate]);
      const { rows } = await c.query("select count(*)::int n from public.email_log where to_address = 'other@example.test'");
      expect(rows[0].n).toBe(0);
    });
  });
});

describe("media_assets", () => {
  const insert = (c: Client, createdBy: string, id = crypto.randomUUID()) =>
    c.query(
      "insert into public.media_assets (id, organization_id, content_type, data, byte_size, sha256, created_by) values ($1, $2, 'image/png', $3::bytea, 16, $4, $5)",
      [id, o.orgId, PNG_HEX, "a".repeat(64), createdBy],
    );

  it("marketing or course managers upload; the image bytes are not readable through the API roles", async () => {
    const id = crypto.randomUUID();
    await as(db, user(o.ownerId), (c) => insert(c, o.ownerId, id), true);
    await as(db, user(o.ownerId), async (c) => {
      const { rows } = await c.query("select id, content_type, byte_size from public.media_assets where id = $1", [id]);
      expect(rows).toEqual([{ id, content_type: "image/png", byte_size: 16 }]);
    });
    await expect(as(db, user(o.ownerId), (c) => c.query("select data from public.media_assets where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, user(o.ownerId), (c) => c.query("update public.media_assets set content_type = 'image/gif' where id = $1", [id]))).rejects.toThrow(/permission denied/);
    const { rows } = await as(db, svc, (c) => c.query("select encode(data, 'hex') as hex from public.media_assets where id = $1", [id]));
    expect(rows[0].hex).toBe(PNG_HEX.slice(2));
  });

  it("refuses uploads by members without manage permissions, on behalf of others, or of other types", async () => {
    await expect(as(db, user(o.staffId), (c) => insert(c, o.staffId))).rejects.toThrow(/row-level security/);
    await expect(as(db, user(o.instructorId), (c) => insert(c, o.instructorId))).rejects.toThrow(/row-level security/);
    await expect(as(db, user(o.ownerId), (c) => insert(c, o.staffId))).rejects.toThrow(/row-level security/);
    await expect(
      as(db, user(o.ownerId), (c) =>
        c.query("insert into public.media_assets (organization_id, content_type, data, byte_size, sha256, created_by) values ($1, 'image/svg+xml', '\\x3c737667', 4, $2, $3)", [o.orgId, "a".repeat(64), o.ownerId]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("anon cannot read or upload", async () => {
    await expect(as(db, { role: "anon" }, (c) => insert(c, o.ownerId))).rejects.toThrow(/permission denied/);
  });
});

describe("function grants", () => {
  it("keeps public read functions callable by anon", async () => {
    const { rows } = await as(db, { role: "anon" }, (c) => c.query("select public.get_public_courses() is not null as ok"));
    expect(rows[0].ok).toBe(true);
  });
});
