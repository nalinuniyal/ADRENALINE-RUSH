import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let courseA: string;
let courseB: string;
let batchA: string;
const cand: Record<string, string> = {};

type Who = Parameters<typeof as>[1];
async function q<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = [], commit = true) {
  return as(db, who, async (c) => (await c.query(sql, params)).rows as T[], commit);
}
const owner = () => user(o.ownerId);
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
// Wide period around "now" so UTC/IST date boundaries never matter for these checks.
const FROM = day(-60);
const TO = day(2);

async function enroll(candidateId: string, fee: number) {
  const [e] = await q<{ id: string }>(
    owner(),
    "insert into public.enrollments (organization_id, candidate_id, batch_id, course_id, status, created_by) values ($1, $2, $3, $4, 'active', $5) returning id",
    [o.orgId, candidateId, batchA, courseA, o.ownerId],
  );
  const [p] = await q<{ id: string }>(owner(), "select public.save_fee_plan($1, 'INR', $2, 'none', 0, null, null, '[]'::jsonb) as id", [e.id, fee]);
  return { enrollmentId: e.id, planId: p.id };
}
async function pay(planId: string, amount: number, status = "completed") {
  const [p] = await q<{ id: string }>(
    owner(),
    `insert into public.payments (organization_id, fee_plan_id, amount, currency, paid_on, method, status, recorded_by)
     values ($1, $2, $3, 'INR', $4, 'upi', $5, $6) returning id`,
    [o.orgId, planId, amount, day(-1), status, o.ownerId],
  );
  return p.id;
}

const summary = (who: Who = owner()) =>
  q<{ gross: string; refunds: string; net: string; expenses: string; cash_result: string; outstanding: string }>(who, "select * from public.finance_summary($1, $2, $3)", [o.orgId, FROM, TO]).then((r) => r[0]);

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  courseA = (await q<{ id: string }>(owner(), "insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic Analytics Course', 'synthetic-analytics', 'published') returning id", [o.orgId]))[0].id;
  courseB = (await q<{ id: string }>(owner(), "insert into public.courses (organization_id, title, slug, status) values ($1, 'Second Synthetic Course', 'second-synthetic', 'published') returning id", [o.orgId]))[0].id;
  batchA = (await q<{ id: string }>(owner(), "insert into public.batches (organization_id, course_id, name, status) values ($1, $2, 'Analytics Batch', 'open') returning id", [o.orgId, courseA]))[0].id;

  const people: [string, string | null, string | null][] = [
    ["a", "telegram", "oct-batch"],
    ["b", "telegram", "oct-batch"],
    ["c", "linkedin", null],
    ["d", null, null],
  ];
  for (const [key, utm, campaign] of people) {
    cand[key] = (
      await q<{ id: string }>(owner(), "insert into public.candidates (organization_id, full_name, email, source, utm_source, utm_campaign) values ($1, $2, $3, 'website', $4, $5) returning id", [
        o.orgId, `Lead ${key.toUpperCase()} Example`, `${key}@example.test`, utm, campaign,
      ])
    )[0].id;
  }
  // Staff can only see candidate "e" (assigned to them).
  cand.e = (await q<{ id: string }>(owner(), "insert into public.candidates (organization_id, full_name, email, owner_id) values ($1, 'Lead E Example', 'e@example.test', $2) returning id", [o.orgId, o.staffId]))[0].id;

  await q(owner(), "insert into public.course_registrations (organization_id, candidate_id, course_id, channel) values ($1, $2, $3, 'public_form'), ($1, $4, $3, 'demo_request')", [o.orgId, cand.a, courseA, cand.b]);

  // Demo session yesterday: "c" invited and attended.
  const [demo] = await q<{ id: string }>(
    owner(),
    "insert into public.class_sessions (organization_id, kind, course_id, title, starts_at, ends_at) values ($1, 'demo', $2, 'Demo', now() - interval '1 day', now() - interval '23 hours') returning id",
    [o.orgId, courseA],
  );
  await q(owner(), "insert into public.session_attendees (session_id, candidate_id, organization_id) values ($1, $2, $3)", [demo.id, cand.c, o.orgId]);
  await q(owner(), "insert into public.attendance_records (organization_id, session_id, candidate_id, status) values ($1, $2, $3, 'present')", [o.orgId, demo.id, cand.c]);
});
afterAll(async () => drop?.());

describe("analytics reconcile with finance", () => {
  let planA: string;
  let planC: string;

  it("money totals equal the finance overview after payments, a refund and expenses", async () => {
    ({ planId: planA } = await enroll(cand.a, 30000));
    ({ planId: planC } = await enroll(cand.c, 20000));
    const p1 = await pay(planA, 10000);
    await pay(planC, 5000);
    await pay(planC, 999, "pending"); // never counted
    await q(owner(), "insert into public.payment_refunds (organization_id, payment_id, amount, refunded_on, method, reason, recorded_by) values ($1, $2, 2000, $3, 'bank_transfer', 'Synthetic refund', $4)", [o.orgId, p1, day(-1), o.ownerId]);
    const [cat] = await q<{ id: string }>(owner(), "select id from public.expense_categories where organization_id = $1 order by position limit 1", [o.orgId]);
    await q(owner(), "insert into public.expenses (organization_id, category_id, spent_on, amount, description, created_by) values ($1, $2, $3, 3000, 'Ads', $4), ($1, $2, $3, 100, 'Mistake', $4)", [o.orgId, cat.id, day(-1), o.ownerId]);
    await q(owner(), "update public.expenses set status = 'voided', void_reason = 'Entered by mistake' where description = 'Mistake'");

    const s = await summary();
    expect(s).toMatchObject({ gross: "15000.00", refunds: "2000.00", net: "13000.00", expenses: "3000.00", cash_result: "10000.00", outstanding: "37000.00" });

    const months = await q<{ collections: string; refunds: string; expenses: string; net: string; cash_result: string }>(owner(), "select * from public.analytics_money_series($1, $2, $3)", [o.orgId, FROM, TO]);
    const sum = (k: keyof (typeof months)[number]) => months.reduce((t, m) => t + Number(m[k]), 0);
    expect(sum("collections")).toBe(Number(s.gross));
    expect(sum("refunds")).toBe(Number(s.refunds));
    expect(sum("expenses")).toBe(Number(s.expenses));
    expect(sum("net")).toBe(Number(s.net));
    expect(sum("cash_result")).toBe(Number(s.cash_result));

    const courses = await q<{ course_id: string; revenue: string; outstanding: string; enrollments: number; registrations: number; demo_bookings: number }>(
      owner(),
      "select * from public.analytics_course_performance($1, $2, $3)",
      [o.orgId, FROM, TO],
    );
    expect(courses.reduce((t, c) => t + Number(c.revenue), 0)).toBe(Number(s.net));
    expect(courses.reduce((t, c) => t + Number(c.outstanding), 0)).toBe(Number(s.outstanding));
    const a = courses.find((c) => c.course_id === courseA)!;
    expect(a).toMatchObject({ registrations: 2, enrollments: 2, demo_bookings: 2, revenue: "13000.00" });
    expect(courses.find((c) => c.course_id === courseB)).toMatchObject({ registrations: 0, revenue: "0.00" });
  });

  it("counts leads, demo bookings, conversion and enrollments", async () => {
    const [k] = await q<Record<string, number>>(owner(), "select * from public.analytics_kpis($1, $2, $3)", [o.orgId, FROM, TO]);
    expect(k).toMatchObject({ new_leads: 5, registrations: 2, demo_bookings: 2, demo_enrolled: 1, enrollments: 2, active_students: 2 });

    const series = await q<{ leads: number; enrollments: number }>(owner(), "select * from public.analytics_activity_series($1, $2, $3, 'day')", [o.orgId, FROM, TO]);
    expect(series).toHaveLength(63);
    expect(series.reduce((t, r) => t + r.leads, 0)).toBe(5);
    expect(series.reduce((t, r) => t + r.enrollments, 0)).toBe(2);
  });

  it("builds a funnel that never widens", async () => {
    const f = await q<{ stage: number; key: string; label: string; candidates: number }>(owner(), "select * from public.analytics_funnel($1, $2, $3)", [o.orgId, FROM, TO]);
    // a: enrolled; b: demo requested; c: demo attended + enrolled; d, e: new.
    expect(f.map((r) => r.candidates)).toEqual([5, 3, 3, 2, 2]);
    expect(f[4].label).toBe("Enrolled");
  });

  it("groups leads by source and campaign", async () => {
    const rows = await q<{ channel: string; utm_campaign: string | null; leads: number; demo_bookings: number; enrolled: number }>(owner(), "select * from public.analytics_lead_sources($1, $2, $3)", [o.orgId, FROM, TO]);
    expect(rows.find((r) => r.channel === "telegram")).toMatchObject({ utm_campaign: "oct-batch", leads: 2, demo_bookings: 1, enrolled: 1 });
    expect(rows.find((r) => r.channel === "website")).toMatchObject({ leads: 1 });
    expect(rows.reduce((t, r) => t + r.leads, 0)).toBe(5);
  });

  it("averages batch attendance (excused left out)", async () => {
    const [s] = await q<{ id: string }>(
      owner(),
      "insert into public.class_sessions (organization_id, kind, batch_id, course_id, title, starts_at, ends_at) values ($1, 'class', $2, $3, 'Class 1', now() - interval '2 hours', now() - interval '1 hour') returning id",
      [o.orgId, batchA, courseA],
    );
    await q(owner(), "insert into public.attendance_records (organization_id, session_id, candidate_id, status) values ($1, $2, $3, 'present'), ($1, $2, $4, 'absent')", [o.orgId, s.id, cand.a, cand.c]);
    const [b] = await q<{ sessions: number; present: number; absent: number; attendance_rate: string }>(owner(), "select * from public.analytics_batch_attendance($1, $2, $3)", [o.orgId, FROM, TO]);
    expect(b).toMatchObject({ sessions: 1, present: 1, absent: 1, attendance_rate: "50.0" });
  });

  it("ranks shared resources", async () => {
    const [r] = await q<{ id: string }>(owner(), "insert into public.resources (organization_id, title, slug, url, visibility) values ($1, 'Demo Recording', 'demo-recording', 'https://example.test/v', 'shareable') returning id", [o.orgId]);
    for (const c of [cand.a, cand.a, cand.b]) {
      await q(owner(), "insert into public.resource_shares (organization_id, candidate_id, resource_ids, method, status, shared_by) values ($1, $2, $3, 'copy_link', 'copied', $4)", [o.orgId, c, [r.id], o.ownerId]);
    }
    const top = await q<{ title: string; shares: number; candidates: number }>(owner(), "select * from public.analytics_top_resources($1, $2, $3)", [o.orgId, FROM, TO]);
    expect(top[0]).toMatchObject({ title: "Demo Recording", shares: 3, candidates: 2 });
  });
});

describe("periods", () => {
  it("uses the business time zone for timestamps", async () => {
    // 19:00 UTC on 31 March = 00:30 IST on 1 April.
    await q(owner(), "insert into public.candidates (organization_id, full_name, email, created_at) values ($1, 'Late Night Lead', 'late@example.test', '2025-03-31T19:00:00Z')", [o.orgId]);
    const march = await q<{ new_leads: number }>(owner(), "select new_leads from public.analytics_kpis($1, '2025-03-01', '2025-03-31')", [o.orgId]);
    const april = await q<{ new_leads: number }>(owner(), "select new_leads from public.analytics_kpis($1, '2025-04-01', '2025-04-30')", [o.orgId]);
    expect(march[0].new_leads).toBe(0);
    expect(april[0].new_leads).toBe(1);
  });

  it("rejects an inverted period", async () => {
    await expect(q(owner(), "select * from public.analytics_funnel($1, $2, $3)", [o.orgId, TO, FROM])).rejects.toThrow(/valid period/);
  });
});

describe("access", () => {
  it("instructor without reports.view is denied", async () => {
    await expect(q(user(o.instructorId), "select * from public.analytics_funnel($1, $2, $3)", [o.orgId, FROM, TO])).rejects.toThrow(/permission to view analytics/);
    await expect(q(user(o.instructorId), "select * from public.analytics_course_performance($1, $2, $3)", [o.orgId, FROM, TO])).rejects.toThrow(/permission/);
  });

  it("anonymous visitors cannot call the functions at all", async () => {
    await expect(q({ role: "anon" }, "select * from public.analytics_kpis($1, $2, $3)", [o.orgId, FROM, TO])).rejects.toThrow(/permission denied/);
    await expect(q({ role: "anon" }, "select * from public.analytics_money_series($1, $2, $3)", [o.orgId, FROM, TO])).rejects.toThrow(/permission denied/);
  });

  it("outsiders are denied", async () => {
    await expect(q(user(o.outsiderId), "select * from public.analytics_kpis($1, $2, $3)", [o.orgId, FROM, TO])).rejects.toThrow(/permission/);
  });

  it("staff with reports.view but without finance.view get counts for their own candidates and no money", async () => {
    await as(
      db,
      { role: "service_role" },
      (c) =>
        c.query(
          `insert into public.membership_permission_overrides (membership_id, permission_key, allowed)
           select id, 'reports.view', true from public.organization_memberships where user_id = $1`,
          [o.staffId],
        ),
      true,
    );
    const staff = user(o.staffId);
    const [k] = await q<{ new_leads: number }>(staff, "select * from public.analytics_kpis($1, $2, $3)", [o.orgId, FROM, TO]);
    expect(k.new_leads).toBe(1); // RLS: only the assigned candidate
    const courses = await q<{ revenue: string | null; outstanding: string | null; collections: string | null }>(staff, "select * from public.analytics_course_performance($1, $2, $3)", [o.orgId, FROM, TO]);
    expect(courses.length).toBeGreaterThan(0);
    for (const c of courses) expect([c.revenue, c.outstanding, c.collections]).toEqual([null, null, null]);
    await expect(q(staff, "select * from public.analytics_money_series($1, $2, $3)", [o.orgId, FROM, TO])).rejects.toThrow(/permission to view finance/);
    await expect(q(staff, "select * from public.finance_summary($1, $2, $3)", [o.orgId, FROM, TO])).rejects.toThrow(/permission to view finance/);
  });

  it("dashboard KPIs work for a member with dashboard.view only", async () => {
    const [k] = await q<{ new_leads: number }>(user(o.instructorId), "select * from public.analytics_kpis($1, $2, $3)", [o.orgId, FROM, TO]);
    expect(k.new_leads).toBe(0); // instructors cannot read the CRM
  });
});
