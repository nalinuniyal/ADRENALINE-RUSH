import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let courseId: string;
const plan: Record<string, string> = {};
const inst: Record<string, string> = {};

type Who = Parameters<typeof as>[1];
const anon: Who = { role: "anon" };
async function q<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = [], commit = true) {
  return as(db, who, async (c) => (await c.query(sql, params)).rows as T[], commit);
}
const owner = () => user(o.ownerId);
const staff = () => user(o.staffId);
const instructor = () => user(o.instructorId);
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Makes a pay link as `who`; returns the raw token (only its hash is stored). */
async function makeLink(planId: string, mode = "next_installment", who: Who = owner()) {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await q(who, "select public.create_fee_pay_link($1, $2, $3, $4, $5)", [planId, mode, id, randomBytes(18).toString("base64url"), sha(token)]);
  return { token, id };
}
const page = (token: string, who: Who = anon) => q<{ p: Record<string, unknown> }>(who, "select public.get_fee_pay_page($1) as p", [sha(token)]).then((r) => r[0].p);
const submit = (token: string, amount: number, utr: string, extra: { paidOn?: string; method?: string; screenshot?: Buffer | null; type?: string | null } = {}, who: Who = anon) =>
  q<{ r: { result: string; id?: string } }>(who, "select public.submit_fee_payment_proof($1, $2, $3, $4, $5, $6, $7, $8) as r", [
    sha(token),
    amount,
    extra.paidOn ?? day(0),
    extra.method ?? "upi",
    utr,
    "Synthetic note",
    extra.screenshot ?? null,
    extra.type ?? null,
  ]).then((r) => r[0].r);
const outstanding = (planId: string) => q<{ outstanding: string }>(owner(), "select outstanding from public.fee_plan_balances where fee_plan_id = $1", [planId]).then((r) => r[0].outstanding);

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  courseId = (await q<{ id: string }>(owner(), "insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic UPI Course', 'synthetic-upi', 'published') returning id", [o.orgId]))[0].id;
  for (const key of ["a", "b", "c"]) {
    const cand = (await q<{ id: string }>(owner(), "insert into public.candidates (organization_id, full_name, email) values ($1, $2, $3) returning id", [o.orgId, `Pay${key.toUpperCase()} Example Student`, `${key}@example.test`]))[0].id;
    const enr = (await q<{ id: string }>(owner(), "insert into public.enrollments (organization_id, candidate_id, course_id, status, created_by) values ($1, $2, $3, 'active', $4) returning id", [o.orgId, cand, courseId, o.ownerId]))[0].id;
    plan[key] = (
      await q<{ id: string }>(owner(), "select public.save_fee_plan($1, 'INR', 15000, 'none', 0, null, null, $2::jsonb) as id", [
        enr,
        JSON.stringify([
          { due_date: day(-5), amount: 5000 },
          { due_date: day(25), amount: 10000 },
        ]),
      ])
    )[0].id;
    inst[key] = (await q<{ id: string }>(owner(), "select id from public.fee_installments where fee_plan_id = $1 and seq = 1", [plan[key]]))[0].id;
  }
  // Staff can see candidate "a" in the CRM; that must not reveal any money or bank details.
  await q(owner(), "update public.candidates set owner_id = $1 where id = (select candidate_id from public.fee_plans where id = $2)", [o.staffId, plan.a]);
});
afterAll(async () => drop?.());

describe("payment details", () => {
  it("are seeded per organization and editable by the owner", async () => {
    await q(owner(), "update public.payment_settings set upi_vpa = ' Test.Academy@YBL ', upi_payee_name = 'Test Academy', bank_account_holder = 'Test Academy', bank_account_number = '1234 5678 9012', bank_ifsc = 'hdfc0001234', bank_name = 'Test Bank', instructions = 'Add your name in the note.' where organization_id = $1", [o.orgId]);
    const [s] = await q<{ upi_vpa: string; bank_ifsc: string; bank_account_last4: string }>(owner(), "select upi_vpa, bank_ifsc, bank_account_last4 from public.payment_settings where organization_id = $1", [o.orgId]);
    expect(s).toEqual({ upi_vpa: "test.academy@ybl", bank_ifsc: "HDFC0001234", bank_account_last4: "9012" });
  });

  it("reject malformed UPI IDs, IFSC and account numbers", async () => {
    await expect(q(owner(), "update public.payment_settings set upi_vpa = 'not-a-vpa' where organization_id = $1", [o.orgId])).rejects.toThrow(/check constraint/);
    await expect(q(owner(), "update public.payment_settings set bank_ifsc = 'HDFC1001234' where organization_id = $1", [o.orgId])).rejects.toThrow(/check constraint/);
    await expect(q(owner(), "update public.payment_settings set bank_account_number = '12AB' where organization_id = $1", [o.orgId])).rejects.toThrow(/check constraint/);
  });

  it("hide the full account number from direct reads; finance viewers get it through the function", async () => {
    await expect(q(owner(), "select bank_account_number from public.payment_settings")).rejects.toThrow(/permission denied/);
    const [full] = await q<{ n: string }>(owner(), "select public.payment_settings_account_number($1) as n", [o.orgId]);
    expect(full.n).toBe("123456789012");
    const [none] = await q<{ n: string | null }>(staff(), "select public.payment_settings_account_number($1) as n", [o.orgId]);
    expect(none.n).toBeNull();
  });

  it("are not readable or writable by staff, instructors or anon", async () => {
    expect(await q(staff(), "select upi_vpa from public.payment_settings")).toHaveLength(0);
    expect(await q(instructor(), "select upi_vpa from public.payment_settings")).toHaveLength(0);
    expect(await q(staff(), "update public.payment_settings set upi_vpa = 'evil@ybl' returning organization_id")).toHaveLength(0);
    await expect(q(anon, "select upi_vpa from public.payment_settings")).rejects.toThrow(/permission denied/);
  });

  it("are audited with the account number masked", async () => {
    const rows = await q<{ details: { changed: Record<string, unknown> } }>(owner(), "select details from public.audit_logs where action = 'payment_settings.updated' order by created_at");
    expect(rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("123456789012");
    expect(text).toContain("••••9012");
  });

  it("appear on public course pages only when switched on", async () => {
    const off = await q<{ d: unknown }>(anon, "select public.get_public_payment_details() as d");
    expect(off[0].d).toBeNull();
    await q(owner(), "update public.payment_settings set show_on_course_pages = true where organization_id = $1", [o.orgId]);
    const on = await q<{ d: { upi_vpa: string } }>(anon, "select public.get_public_payment_details() as d");
    expect(on[0].d.upi_vpa).toBe("test.academy@ybl");
    await q(owner(), "update public.payment_settings set show_on_course_pages = false where organization_id = $1", [o.orgId]);
  });
});

describe("pay links", () => {
  it("are made by finance managers only, one live link per plan", async () => {
    await expect(makeLink(plan.a, "next_installment", staff())).rejects.toThrow(/permission/);
    await expect(makeLink(plan.a, "next_installment", instructor())).rejects.toThrow(/permission/);
    const first = await makeLink(plan.a);
    const second = await makeLink(plan.a);
    const rows = await q<{ id: string; status: string }>(owner(), "select id, status from public.fee_pay_links where fee_plan_id = $1 order by created_at", [plan.a]);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [first.id, "revoked"],
      [second.id, "active"],
    ]);
    expect(await page(first.token)).toEqual({ status: "revoked", business_name: "Test Academy" });
    // The token hash is write-only for app users; anon cannot read the table at all.
    await expect(q(owner(), "select token_hash from public.fee_pay_links")).rejects.toThrow(/permission denied/);
    await expect(q(anon, "select id from public.fee_pay_links")).rejects.toThrow(/permission denied/);
    expect(await q(staff(), "select id from public.fee_pay_links")).toHaveLength(0);
  });

  it("show only what the candidate needs, with the amount due now", async () => {
    const { token } = await makeLink(plan.b);
    const p = await page(token);
    expect(p).toMatchObject({
      status: "ok",
      business_name: "Test Academy",
      first_name: "PayB",
      course_title: "Synthetic UPI Course",
      currency: "INR",
      amount_due: 5000,
      outstanding: 15000,
      installment_label: "Installment 1",
      upi_vpa: "test.academy@ybl",
      bank: { account_number: "123456789012", ifsc: "HDFC0001234" },
    });
    expect(Object.keys(p)).not.toEqual(expect.arrayContaining(["email", "phone", "candidate_id", "fee_plan_id"]));
    expect(JSON.stringify(p)).not.toContain("b@example.test");
    const full = await makeLink(plan.b, "balance");
    expect(await page(full.token)).toMatchObject({ amount_due: 15000, amount_mode: "balance" });
    expect(await page("unknown-token")).toEqual({ status: "not_found" });
    expect(await q<{ p: unknown }>(anon, "select public.get_fee_pay_page('not-a-hash') as p")).toEqual([{ p: { status: "not_found" } }]);
  });

  it("can be revoked, after which the token is denied", async () => {
    const { token, id } = await makeLink(plan.c);
    expect(await q(staff(), "update public.fee_pay_links set status = 'revoked' where id = $1 returning id", [id])).toHaveLength(0);
    await q(owner(), "update public.fee_pay_links set status = 'revoked' where id = $1", [id]);
    expect((await page(token)).status).toBe("revoked");
    expect((await submit(token, 100, "REVOKED0001")).result).toBe("revoked");
    await expect(q(owner(), "update public.fee_pay_links set status = 'active' where id = $1", [id])).rejects.toThrow(/cannot be switched back/);
    const logs = await q<{ action: string }>(owner(), "select action from public.audit_logs where entity_id = $1 order by created_at", [id]);
    expect(logs.map((l) => l.action)).toEqual(["pay_link.created", "pay_link.revoked"]);
  });
});

describe("payment submissions", () => {
  let token: string;
  let subId: string;

  beforeAll(async () => {
    ({ token } = await makeLink(plan.a));
  });

  it("are created as pending through the token only", async () => {
    const r = await submit(token, 5000, "4123 4567 8901", { screenshot: Buffer.from([0x89, 0x50, 0x4e, 0x47]), type: "image/png" });
    expect(r.result).toBe("ok");
    subId = r.id as string;
    const [s] = await q<{ status: string; utr: string; installment_id: string; payment_id: string | null; has_screenshot: boolean }>(owner(), "select status, utr, installment_id, payment_id, has_screenshot from public.payment_submissions where id = $1", [subId]);
    expect(s).toEqual({ status: "pending", utr: "412345678901", installment_id: inst.a, payment_id: null, has_screenshot: true });
    // Nothing is counted as collected yet.
    expect(await outstanding(plan.a)).toBe("15000.00");
    expect((await page(token)).pending_submissions).toBe(1);
  });

  it("validate amount, date, method and UTR", async () => {
    expect((await submit(token, 0, "AAAA11112222")).result).toBe("invalid_amount");
    expect((await submit(token, 20000, "AAAA11112222")).result).toBe("invalid_amount");
    expect((await submit(token, 10, "AAAA11112222", { paidOn: day(5) })).result).toBe("invalid_date");
    expect((await submit(token, 10, "AAAA11112222", { method: "cash" })).result).toBe("invalid_method");
    expect((await submit(token, 10, "12/34")).result).toBe("invalid_utr");
    expect((await submit(token, 10, "AAAA11112222", { screenshot: Buffer.from([1]), type: "image/svg+xml" })).result).toBe("invalid_screenshot");
  });

  it("reject a duplicate UTR", async () => {
    expect((await submit(token, 100, "412345678901")).result).toBe("duplicate_utr");
    // Also against payments recorded by hand with that reference.
    await q(owner(), "insert into public.payments (organization_id, fee_plan_id, amount, currency, paid_on, method, reference, status, recorded_by) values ($1, $2, 1, 'INR', $3, 'upi', 'manualref777', 'completed', $4)", [o.orgId, plan.c, day(0), o.ownerId]);
    expect((await submit(token, 100, "MANUALREF777")).result).toBe("duplicate_utr");
  });

  it("cannot be read by anon, staff or instructors; screenshot bytes are not granted", async () => {
    await expect(q(anon, "select id from public.payment_submissions")).rejects.toThrow(/permission denied/);
    expect(await q(staff(), "select id from public.payment_submissions")).toHaveLength(0);
    expect(await q(instructor(), "select id from public.payment_submissions")).toHaveLength(0);
    await expect(q(owner(), "select screenshot from public.payment_submissions")).rejects.toThrow(/permission denied/);
    await expect(q(owner(), "insert into public.payment_submissions (organization_id, pay_link_id, fee_plan_id, candidate_id, amount, currency, paid_on, method, utr) select organization_id, id, fee_plan_id, (select candidate_id from public.fee_plans where id = fee_plan_id), 1, 'INR', current_date, 'upi', 'DIRECT00001' from public.fee_pay_links limit 1")).rejects.toThrow(/permission denied/);
    await expect(q(owner(), "update public.payment_submissions set status = 'approved' where id = $1", [subId])).rejects.toThrow(/permission denied/);
  });

  it("can only be approved by finance managers", async () => {
    await expect(q(staff(), "select public.approve_payment_submission($1)", [subId])).rejects.toThrow(/permission/);
    await expect(q(instructor(), "select public.reject_payment_submission($1, 'no reason')", [subId])).rejects.toThrow(/permission/);
    await expect(q(anon, "select public.approve_payment_submission($1)", [subId])).rejects.toThrow(/permission denied/);
  });

  it("approval records exactly one payment with a receipt, and the balance drops", async () => {
    const [r] = await q<{ r: { payment_id: string; receipt_number: string } }>(owner(), "select public.approve_payment_submission($1) as r", [subId]);
    expect(r.r.receipt_number).toMatch(/^AR-\d{4}-\d{4}$/);
    await expect(q(owner(), "select public.approve_payment_submission($1)", [subId])).rejects.toThrow(/already approved/);
    const pays = await q<{ id: string; method: string; reference: string; status: string; amount: string; installment_id: string }>(owner(), "select id, method, reference, status, amount, installment_id from public.payments where fee_plan_id = $1", [plan.a]);
    expect(pays).toEqual([{ id: r.r.payment_id, method: "upi", reference: "412345678901", status: "completed", amount: "5000.00", installment_id: inst.a }]);
    const [s] = await q<{ status: string; payment_id: string; reviewed_by: string }>(owner(), "select status, payment_id, reviewed_by from public.payment_submissions where id = $1", [subId]);
    expect(s).toEqual({ status: "approved", payment_id: r.r.payment_id, reviewed_by: o.ownerId });
    expect(await outstanding(plan.a)).toBe("10000.00");
    expect(await page(token)).toMatchObject({ amount_due: 10000, installment_label: "Installment 2", pending_submissions: 0 });
    const logs = await q<{ action: string }>(owner(), "select action from public.audit_logs where entity_id = $1 order by created_at", [subId]);
    expect(logs.map((l) => l.action)).toEqual(["payment_submission.created", "payment_submission.approved"]);
  });

  it("approval refuses a UTR that was recorded as a payment in the meantime", async () => {
    const r = await submit(token, 1000, "LATEREF0001");
    await q(owner(), "insert into public.payments (organization_id, fee_plan_id, amount, currency, paid_on, method, reference, status, recorded_by) values ($1, $2, 1000, 'INR', $3, 'upi', 'LATEREF0001', 'completed', $4)", [o.orgId, plan.a, day(0), o.ownerId]);
    await expect(q(owner(), "select public.approve_payment_submission($1)", [r.id])).rejects.toThrow(/already recorded/);
    await q(owner(), "select public.reject_payment_submission($1, 'Duplicate of a payment recorded by hand')", [r.id]);
    const [s] = await q<{ status: string; reject_reason: string; payment_id: string | null }>(owner(), "select status, reject_reason, payment_id from public.payment_submissions where id = $1", [r.id]);
    expect(s).toEqual({ status: "rejected", reject_reason: "Duplicate of a payment recorded by hand", payment_id: null });
    await expect(q(owner(), "select public.reject_payment_submission($1, 'again')", [r.id])).rejects.toThrow(/already rejected/);
    // A rejected UTR can be reported again (e.g. after a typo was fixed).
    expect((await submit(token, 500, "LATEREF0002")).result).toBe("ok");
  });

  it("are throttled per link", async () => {
    const { token: t } = await makeLink(plan.b);
    expect((await submit(t, 10, "THROTTLE0001")).result).toBe("ok");
    expect((await submit(t, 10, "THROTTLE0002")).result).toBe("ok");
    expect((await submit(t, 10, "THROTTLE0003")).result).toBe("ok");
    expect((await submit(t, 10, "THROTTLE0004")).result).toBe("too_many");
  });

  it("stop when nothing is due", async () => {
    const { token: t } = await makeLink(plan.c, "balance");
    await q(owner(), "insert into public.payments (organization_id, fee_plan_id, amount, currency, paid_on, method, status, recorded_by) values ($1, $2, 14999, 'INR', $3, 'cash', 'completed', $4)", [o.orgId, plan.c, day(0), o.ownerId]);
    expect((await page(t)).status).toBe("paid");
    expect((await submit(t, 1, "PAIDALREADY1")).result).toBe("paid");
  });
});
