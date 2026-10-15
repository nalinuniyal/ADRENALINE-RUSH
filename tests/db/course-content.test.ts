import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminUrl, as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

const STARTER = readFileSync(path.resolve(__dirname, "../../supabase/starter/mcp-course.sql"), "utf8");

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let courseId: string;

const INCLUSIONS = [
  { title: "Interview practice", description: "Mock interviews", icon: "mic" },
  { title: "One-to-one discussions", icon: "messages-square" },
];

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  courseId = await as(
    db,
    user(o.ownerId),
    async (c) => {
      const { rows } = await c.query(
        `insert into public.courses (organization_id, title, slug, status, inclusions, cta_label, highlight_badge)
         values ($1, 'Synthetic Personalization', 'synthetic-personalization', 'published', $2, 'Book my seat', 'Next demo: Saturday 11 AM') returning id`,
        [o.orgId, JSON.stringify(INCLUSIONS)],
      );
      await c.query("insert into public.courses (organization_id, title, slug, inclusions) values ($1, 'Draft Course', 'draft-course', $2)", [
        o.orgId,
        JSON.stringify(INCLUSIONS),
      ]);
      return rows[0].id as string;
    },
    true,
  );
});
afterAll(async () => drop?.());

describe("course content", () => {
  it("defaults new courses to free-demo registration with no inclusions", async () => {
    const { rows } = await db.query("select registration_mode, inclusions, cta_label from public.courses where slug = 'draft-course'");
    expect(rows[0]).toMatchObject({ registration_mode: "demo", cta_label: null });
  });

  it("returns inclusions, registration mode, label and badge from the public course RPCs", async () => {
    const { rows } = await as(db, { role: "anon" }, (c) =>
      c.query("select public.get_public_course('synthetic-personalization') as c, public.get_public_courses() as l"),
    );
    expect(rows[0].c).toMatchObject({
      inclusions: INCLUSIONS,
      registration_mode: "demo",
      cta_label: "Book my seat",
      highlight_badge: "Next demo: Saturday 11 AM",
    });
    expect(rows[0].l).toHaveLength(1);
    expect(rows[0].l[0]).toMatchObject({ slug: "synthetic-personalization", inclusions: INCLUSIONS, registration_mode: "demo" });
  });

  it("does not expose unpublished courses", async () => {
    const { rows } = await as(db, { role: "anon" }, (c) => c.query("select public.get_public_course('draft-course') as c"));
    expect(rows[0].c).toBeNull();
  });

  it("rejects invalid course content values", async () => {
    await expect(
      as(db, user(o.ownerId), (c) => c.query("update public.courses set registration_mode = 'paid' where id = $1", [courseId])),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(db, user(o.ownerId), (c) => c.query(`update public.courses set inclusions = '{"title": "x"}' where id = $1`, [courseId])),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as(db, user(o.ownerId), (c) => c.query("update public.courses set cta_label = repeat('x', 41) where id = $1", [courseId])),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("site settings", () => {
  it("seeds one settings row per organization", async () => {
    const { rows } = await db.query("select count(*)::int n, bool_and(show_course_catalog) c from public.site_settings where organization_id = $1", [o.orgId]);
    expect(rows[0]).toEqual({ n: 1, c: true });
  });

  it("anon cannot read or change the table directly", async () => {
    await expect(as(db, { role: "anon" }, (c) => c.query("select * from public.site_settings"))).rejects.toThrow(/permission denied/);
    await expect(as(db, { role: "anon" }, (c) => c.query("update public.site_settings set hero_title = 'x'"))).rejects.toThrow(/permission denied/);
  });

  it("staff without settings.manage can neither read nor update", async () => {
    const read = await as(db, user(o.staffId), (c) => c.query("select * from public.site_settings"));
    expect(read.rowCount).toBe(0);
    const upd = await as(db, user(o.staffId), (c) => c.query("update public.site_settings set hero_title = 'Hacked' where organization_id = $1", [o.orgId]));
    expect(upd.rowCount).toBe(0);
    await expect(
      as(db, user(o.staffId), (c) => c.query("insert into public.site_settings (organization_id) values ($1)", [o.orgId])),
    ).rejects.toThrow(/permission denied/);
  });

  it("settings managers update settings; the featured course must belong to the organization", async () => {
    await as(
      db,
      user(o.ownerId),
      (c) =>
        c.query(
          `update public.site_settings set hero_title = 'Learn MCP', contact_email = 'hello@example.test', whatsapp_number = '+91 98765 43210',
             linkedin_url = 'https://www.linkedin.com/company/example', featured_course_id = $2, show_course_catalog = false
           where organization_id = $1`,
          [o.orgId, courseId],
        ),
      true,
    );
    await expect(
      as(db, user(o.ownerId), (c) => c.query("update public.site_settings set linkedin_url = 'http://insecure.example' where organization_id = $1", [o.orgId])),
    ).rejects.toThrow(/check constraint/);

    const otherCourse = await as(
      db,
      { role: "service_role" },
      async (c) => {
        const org2 = await c.query("insert into public.organizations (name, slug) values ('Other Academy', 'other-academy') returning id");
        const crs = await c.query("insert into public.courses (organization_id, title, slug) values ($1, 'Other Course', 'other-course') returning id", [org2.rows[0].id]);
        return crs.rows[0].id as string;
      },
      true,
    );
    await expect(
      as(db, user(o.ownerId), (c) => c.query("update public.site_settings set featured_course_id = $2 where organization_id = $1", [o.orgId, otherCourse])),
    ).rejects.toThrow(/row-level security/);
  });

  it("get_public_site returns public-safe fields of the primary organization only", async () => {
    const { rows } = await as(db, { role: "anon" }, (c) => c.query("select public.get_public_site() as s"));
    const s = rows[0].s;
    expect(s).toMatchObject({
      organization_name: "Test Academy",
      hero_title: "Learn MCP",
      contact_email: "hello@example.test",
      whatsapp_number: "+91 98765 43210",
      show_course_catalog: false,
      social: { linkedin: "https://www.linkedin.com/company/example", instagram: null },
      featured_course: { slug: "synthetic-personalization", title: "Synthetic Personalization", registration_mode: "demo", registration_open: true },
    });
    expect(Object.keys(s).sort()).toEqual(
      [
        "about_text", "address", "contact_email", "contact_phone", "featured_course", "footer_tagline", "hero_badge", "hero_subtitle",
        "hero_title", "organization_name", "show_course_catalog", "social", "whatsapp_number",
      ].sort(),
    );
    const text = JSON.stringify(s);
    for (const secret of [o.orgId, courseId, "owner@example.test", "staff_enabled", "timezone"]) expect(text).not.toContain(secret);
  });

  it("hides the featured course while it is not published", async () => {
    // Inside the same transaction the change is visible; it rolls back afterwards.
    const { rows } = await as(db, user(o.ownerId), async (c) => {
      await c.query("update public.courses set status = 'draft' where id = $1", [courseId]);
      return c.query("select public.get_public_site() as s");
    });
    expect(rows[0].s.featured_course).toBeNull();
  });

  it("deleting the featured course clears it", async () => {
    const { rows } = await as(db, { role: "service_role" }, async (c) => {
      await c.query("delete from public.courses where id = $1", [courseId]);
      return c.query("select featured_course_id from public.site_settings where organization_id = $1", [o.orgId]);
    });
    expect(rows[0].featured_course_id).toBeNull();
  });
});

describe("function privileges", () => {
  it("anon may call get_public_site but not the seed trigger function", async () => {
    const { rows } = await db.query(
      `select has_function_privilege('anon', 'public.get_public_site()', 'execute') as site,
              has_function_privilege('anon', 'public.site_settings_seed()', 'execute') as seed_anon,
              has_function_privilege('authenticated', 'public.site_settings_seed()', 'execute') as seed_auth,
              has_function_privilege('anon', 'public.public_course_json(public.courses)', 'execute') as json_anon`,
    );
    expect(rows[0]).toEqual({ site: true, seed_anon: false, seed_auth: false, json_anon: false });
  });
});

describe("MCP starter script", () => {
  it("applies after setup.sql, creates a draft MCP course and is safe to run twice", async () => {
    const dbName = `ar_starter_${Date.now()}`;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await c.query(readFileSync(path.join(__dirname, "supabase-stub.sql"), "utf8"));
      await c.query(readFileSync(path.resolve(__dirname, "../../supabase/setup.sql"), "utf8"));

      // Without an organization it does nothing.
      await c.query(STARTER);
      expect((await c.query("select count(*)::int n from public.courses")).rows[0].n).toBe(0);

      await seedOrg(c);
      await c.query(STARTER);
      await c.query(STARTER);

      const { rows } = await c.query(
        `select c.id, c.title, c.status, c.delivery_mode, c.registration_mode, c.show_price, c.list_price, c.discounted_price,
                c.inclusions, c.description, cc.slug as category
           from public.courses c left join public.course_categories cc on cc.id = c.category_id where c.slug = 'mcp'`,
      );
      expect(rows).toHaveLength(1);
      const mcp = rows[0];
      expect(mcp).toMatchObject({
        title: "Salesforce Marketing Cloud Personalization (MCP)",
        status: "draft",
        delivery_mode: "online",
        registration_mode: "demo",
        show_price: false,
        list_price: null,
        discounted_price: null,
        category: "salesforce-marketing-cloud",
      });
      expect(mcp.description).toMatch(/STARTER OUTLINE/);
      expect(mcp.inclusions.map((i: { title: string }) => i.title)).toEqual([
        "Interview practice",
        "Interview & placement support",
        "One-to-one discussions",
        "Real-life hands-on projects",
        "Post-course development support",
      ]);

      const counts = await c.query(
        `select (select count(*)::int from public.course_modules where course_id = $1) as modules,
                (select count(*)::int from public.lessons l join public.course_modules m on m.id = l.module_id where m.course_id = $1) as lessons,
                (select count(*)::int from public.course_registration_fields where course_id = $1) as fields,
                (select count(*)::int from public.courses) as courses`,
        [mcp.id],
      );
      expect(counts.rows[0].modules).toBe(10);
      expect(counts.rows[0].lessons).toBeGreaterThanOrEqual(30);
      expect(counts.rows[0].fields).toBeGreaterThanOrEqual(10);
      expect(counts.rows[0].courses).toBe(1);

      // Draft: not public until the owner publishes it.
      const pub = await as(c, { role: "anon" }, (x) => x.query("select public.get_public_course('mcp') as c"));
      expect(pub.rows[0].c).toBeNull();
    } finally {
      await c.end();
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });
});
