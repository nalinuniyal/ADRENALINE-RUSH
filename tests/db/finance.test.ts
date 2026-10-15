import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let courseId: string;
let batchId: string;
const cand: Record<string, string> = {};
const enr: Record<string, string> = {};

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
const year = new Date().getUTCFullYear();

async function savePlan(enrollmentId: string, base: number, installments: { due_date: string; amount: number }[] = [], discount: { type?: string; value?: number; reason?: string | null } = {}, who: Who = owner()) {
  const rows = await q<{ id: string }>(who, "select public.save_fee_plan($1, 'INR', $2, $3, $4, $5, null, $6::jsonb) as id", [
    enrollmentId,
    base,
    discount.type ?? "none",
    discount.value ?? 0,
    discount.reason ?? null,
    JSON.stringify(installments),
  ]);
  return rows[0].id;
}

async function pay(planId: string, amount: number, paidOn: string, extra: Record<string, unknown> = {}, who: Who = owner()) {
  const rows = await q<{ id: string; receipt_number: string | null; status: string }>(
    who,
    `insert into public.payments (organization_id, fee_plan_id, amount, currency, paid_on, method, status, installment_id, recorded_by)
     values ($1, $2, $3, 'INR', $4, $5, $6, $7, $8) returning id, receipt_number, status`,
    [o.orgId, planId, amount, paidOn, extra.method ?? "upi", extra.status ?? "completed", extra.installment_id ?? null, who.role === "authenticated" ? who.userId : null],
  );
  return rows[0];
}

const refund = (paymentId: string, amount: number, who: Who = owner()) =>
  q<{ id: string }>(
    who,
    `insert into public.payment_refunds (organization_id, payment_id, amount, refunded_on, method, reason, recorded_by)
     values ($1, $2, $3, $4, 'bank_transfer', 'Synthetic refund reason', $5) returning id`,
    [o.orgId, paymentId, amount, day(0), who.role === "authenticated" ? who.userId : null],
  );

const schedule = (planId: string, today = day(0)) =>
  q<{ seq: number; paid: string; remaining: string; status: string }>(owner(), "select seq, paid, remaining, status from public.fee_plan_schedule($1, $2)", [planId, today]);
const balance = (planId: string) =>
  q<{ gross_paid: string; refunded: string; net_paid: string; outstanding: string; credit: string }>(owner(), "select * from public.fee_plan_balances where fee_plan_id = $1", [planId]).then((r) => r[0]);

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  courseId = (await q<{ id: string }>(owner(), "insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic Finance Course', 'synthetic-finance', 'published') returning id", [o.orgId]))[0].id;
  batchId = (await q<{ id: string }>(owner(), "insert into public.batches (organization_id, course_id, name, status) values ($1, $2, 'Finance Batch', 'open') returning id", [o.orgId, courseId]))[0].id;
  for (const key of ["a", "b", "c", "d", "e", "f"]) {
    cand[key] = (await q<{ id: string }>(owner(), "insert into public.candidates (organization_id, full_name, email) values ($1, $2, $3) returning id", [o.orgId, `Student ${key.toUpperCase()} Example`, `${key}@example.test`]))[0].id;
    enr[key] = (
      await q<{ id: string }>(
        owner(),
        "insert into public.enrollments (organization_id, candidate_id, batch_id, course_id, status, created_by) values ($1, $2, $3, $4, 'active', $5) returning id",
        [o.orgId, cand[key], batchId, courseId, o.ownerId],
      )
    )[0].id;
  }
  // Staff can see candidate "a" in the CRM, which must not reveal any money.
  await q(owner(), "update public.candidates set owner_id = $1 where id = $2", [o.staffId, cand.a]);
});
afterAll(async () => drop?.());

describe("fee plans and installments", () => {
  it("seeds editable expense categories for the organization", async () => {
    const rows = await q<{ name: string }>(owner(), "select name from public.expense_categories where organization_id = $1 order by position", [o.orgId]);
    expect(rows.map((r) => r.name)).toEqual(["Marketing & ads", "Software & tools", "Trainer payout", "Venue", "Equipment", "Other"]);
  });

  it("computes discounts and the final fee in the database", async () => {
    const id = await savePlan(enr.f, 49999, [], { type: "percent", value: 10, reason: "Early bird" });
    const [p] = await q<{ discount_amount: string; final_fee: string; candidate_id: string }>(owner(), "select discount_amount, final_fee, candidate_id from public.fee_plans where id = $1", [id]);
    expect(p).toMatchObject({ discount_amount: "4999.90", final_fee: "44999.10", candidate_id: cand.f });
    await expect(savePlan(enr.f, 1000, [], { type: "amount", value: 100 })).rejects.toThrow(/reason for the discount/);
    await expect(savePlan(enr.f, 1000, [], { type: "amount", value: 2000, reason: "Too much" })).rejects.toThrow(/more than the fee/);
  });

  it("requires installments to add up to the final fee", async () => {
    await expect(savePlan(enr.e, 30000, [{ due_date: day(1), amount: 10000 }, { due_date: day(30), amount: 10000 }])).rejects.toThrow(/add up to 20000.00 but the final fee is 30000.00/);
    const id = await savePlan(enr.e, 30000, [
      { due_date: day(1), amount: 10000 },
      { due_date: day(30), amount: 10000.5 },
      { due_date: day(60), amount: 9999.5 },
    ]);
    const n = await q(owner(), "select 1 from public.fee_installments where fee_plan_id = $1", [id]);
    expect(n).toHaveLength(3);
    // Changing the fee without the schedule breaks the rule and is rejected at commit.
    await expect(q(owner(), "update public.fee_plans set base_fee = 31000 where id = $1", [id])).rejects.toThrow(/add up to/);
    // Re-saving with fewer installments keeps installment ids by position.
    const [first] = await q<{ id: string }>(owner(), "select id from public.fee_installments where fee_plan_id = $1 and seq = 1", [id]);
    await savePlan(enr.e, 30000, [{ due_date: day(1), amount: 15000 }, { due_date: day(30), amount: 15000 }]);
    const after = await q<{ id: string; seq: number }>(owner(), "select id, seq from public.fee_installments where fee_plan_id = $1 order by seq", [id]);
    expect(after).toHaveLength(2);
    expect(after[0].id).toBe(first.id);
  });

  it("one fee plan per enrollment", async () => {
    await expect(
      q(owner(), "insert into public.fee_plans (organization_id, enrollment_id, candidate_id, course_id, base_fee, created_by) values ($1, $2, $3, $4, 1, $5)", [o.orgId, enr.e, cand.e, courseId, o.ownerId]),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("payments, receipts, allocation and refunds", () => {
  let plan: string;
  let firstPayment: string;

  it("numbers receipts sequentially per organization and year; pending payments get none until received", async () => {
    plan = await savePlan(enr.b, 30000, [
      { due_date: day(-40), amount: 10000 },
      { due_date: day(-10), amount: 10000 },
      { due_date: day(20), amount: 10000 },
    ]);
    const p1 = await pay(plan, 15000, day(-5));
    firstPayment = p1.id;
    const p2 = await pay(plan, 500, day(-1), { status: "pending", method: "cheque" });
    expect(p1.receipt_number).toBe(`AR-${new Date(day(-5)).getUTCFullYear()}-0001`);
    expect(p2.receipt_number).toBeNull();
    const [done] = await q<{ receipt_number: string }>(owner(), "update public.payments set status = 'completed' where id = $1 returning receipt_number", [p2.id]);
    expect(done.receipt_number).toMatch(new RegExp(`^AR-${new Date(day(-1)).getUTCFullYear()}-000[12]$`));
    // Void it again for the following maths.
    await q(owner(), "update public.payments set status = 'voided', void_reason = 'Entered twice' where id = $1", [p2.id]);
    const [p3] = [await pay(plan, 1, day(0))];
    expect(p3.receipt_number).toMatch(new RegExp(`^AR-${year}-000[23]$`));
    await q(owner(), "update public.payments set status = 'voided', void_reason = 'Test entry' where id = $1", [p3.id]);
  });

  it("derives installment status from payments: partial payments, overdue and outstanding", async () => {
    const s = await schedule(plan);
    expect(s.map((r) => [r.seq, r.paid, r.remaining, r.status])).toEqual([
      [1, "10000.00", "0.00", "paid"],
      [2, "5000.00", "5000.00", "overdue"],
      [3, "0.00", "10000.00", "due"],
    ]);
    const b = await balance(plan);
    expect(b).toMatchObject({ gross_paid: "15000.00", refunded: "0.00", net_paid: "15000.00", outstanding: "15000.00", credit: "0.00" });
    const overdue = await q<{ seq: number; remaining: string }>(owner(), "select seq, remaining from public.finance_overdue_installments($1)", [o.orgId]);
    expect(overdue).toEqual([{ seq: 2, remaining: "5000.00" }]);
  });

  it("applies a payment to the chosen installment first", async () => {
    const [third] = await q<{ id: string }>(owner(), "select id from public.fee_installments where fee_plan_id = $1 and seq = 3", [plan]);
    const p = await pay(plan, 4000, day(0), { installment_id: third.id });
    const s = await schedule(plan);
    expect(s.map((r) => [r.seq, r.remaining, r.status])).toEqual([
      [1, "0.00", "paid"],
      [2, "5000.00", "overdue"],
      [3, "6000.00", "partially_paid"],
    ]);
    await q(owner(), "update public.payments set status = 'voided', void_reason = 'Allocation test' where id = $1", [p.id]);
  });

  it("caps refunds at what is left of the payment, under the row lock", async () => {
    await expect(refund(firstPayment, 15000.01)).rejects.toThrow(/cannot exceed the payment/);
    const [r1] = await refund(firstPayment, 6000);
    await expect(refund(firstPayment, 9000.01)).rejects.toThrow(/9000.00 can still be refunded/);
    // Voiding a refund frees its amount again.
    await q(owner(), "update public.payment_refunds set status = 'voided', void_reason = 'Wrong amount' where id = $1", [r1.id]);
    await refund(firstPayment, 5000);
    const b = await balance(plan);
    expect(b).toMatchObject({ gross_paid: "15000.00", refunded: "5000.00", net_paid: "10000.00", outstanding: "20000.00" });
    const s = await schedule(plan);
    expect(s.map((r) => r.status)).toEqual(["paid", "overdue", "due"]);
  });

  it("never edits or deletes payments; voiding needs a reason and no live refunds", async () => {
    await expect(q(owner(), "update public.payments set amount = 1 where id = $1", [firstPayment])).rejects.toThrow(/permission denied/);
    await expect(q(owner(), "delete from public.payments where id = $1", [firstPayment])).rejects.toThrow(/permission denied/);
    await expect(q(owner(), "delete from public.payment_refunds")).rejects.toThrow(/permission denied/);
    await expect(q(owner(), "update public.payments set status = 'voided' where id = $1", [firstPayment])).rejects.toThrow(/refunds of this payment first/);
    await expect(q(owner(), "update public.payments set status = 'pending' where id = $1", [firstPayment])).rejects.toThrow(/can only be voided/);
    await expect(pay(plan, 100, day(30))).rejects.toThrow(/future/);
    const audit = await db.query("select action from public.audit_logs where entity_type = 'payment' order by id");
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["payment.created", "payment.updated", "payment.voided"]));
    const refundAudit = await db.query("select action from public.audit_logs where entity_type = 'payment_refund' order by id");
    expect(refundAudit.rows.map((r) => r.action)).toEqual(["payment_refund.created", "payment_refund.voided", "payment_refund.created"]);
  });
});

describe("overview totals", () => {
  it("net collections = gross - refunds; cash result = net - expenses; pending/failed/voided never count", async () => {
    const before = (await q<Record<string, string>>(owner(), "select * from public.finance_summary($1)", [o.orgId]))[0];
    const plan = await savePlan(enr.c, 20000);
    const p = await pay(plan, 8000, day(0));
    await pay(plan, 999, day(0), { status: "pending" });
    await pay(plan, 777, day(0), { status: "failed" });
    await refund(p.id, 1000);
    const [cat] = await q<{ id: string }>(owner(), "select id from public.expense_categories where organization_id = $1 and name = 'Venue'", [o.orgId]);
    await q(owner(), "insert into public.expenses (organization_id, category_id, spent_on, amount, description, method, batch_id, created_by) values ($1, $2, $3, 2500.25, 'Room hire', 'upi', $4, $5)", [
      o.orgId,
      cat.id,
      day(0),
      batchId,
      o.ownerId,
    ]);
    const [voided] = await q<{ id: string }>(owner(), "insert into public.expenses (organization_id, category_id, spent_on, amount, description, method, created_by) values ($1, $2, $3, 100, 'Mistake', 'cash', $4) returning id", [
      o.orgId,
      cat.id,
      day(0),
      o.ownerId,
    ]);
    await q(owner(), "update public.expenses set status = 'voided', void_reason = 'Duplicate entry' where id = $1", [voided.id]);

    const after = (await q<Record<string, string>>(owner(), "select * from public.finance_summary($1)", [o.orgId]))[0];
    const diff = (k: string) => Number(after[k]) - Number(before[k]);
    expect(diff("gross")).toBeCloseTo(8000, 2);
    expect(diff("refunds")).toBeCloseTo(1000, 2);
    expect(diff("net")).toBeCloseTo(7000, 2);
    expect(diff("expenses")).toBeCloseTo(2500.25, 2);
    expect(diff("cash_result")).toBeCloseTo(4499.75, 2);
    expect(diff("outstanding")).toBeCloseTo(13000, 2);
    expect(diff("booked")).toBeCloseTo(20000, 2);
    expect(Number(after.cash_result)).toBeCloseTo(Number(after.net) - Number(after.expenses), 2);

    // Period and course/batch filters.
    const past = (await q<Record<string, string>>(owner(), "select gross, expenses from public.finance_summary($1, $2, $3)", [o.orgId, day(-400), day(-300)]))[0];
    expect(past).toMatchObject({ gross: "0", expenses: "0" });
    const byBatch = (await q<Record<string, string>>(owner(), "select expenses from public.finance_summary($1, null, null, null, $2)", [o.orgId, batchId]))[0];
    expect(byBatch.expenses).toBe("2500.25");
  });

  it("cancelled enrollments drop out of booked fees and outstanding", async () => {
    const before = (await q<Record<string, string>>(owner(), "select booked, outstanding from public.finance_summary($1)", [o.orgId]))[0];
    await q(owner(), "update public.enrollments set status = 'cancelled' where id = $1", [enr.c]);
    const after = (await q<Record<string, string>>(owner(), "select booked, outstanding from public.finance_summary($1)", [o.orgId]))[0];
    expect(Number(before.booked) - Number(after.booked)).toBeCloseTo(20000, 2);
    expect(Number(before.outstanding) - Number(after.outstanding)).toBeCloseTo(13000, 2);
  });
});

describe("row level security", () => {
  const tables = ["fee_plans", "fee_installments", "payments", "payment_refunds", "expenses", "expense_categories", "payment_links", "fee_plan_balances"];

  it("staff, instructors and outsiders cannot read any finance rows", async () => {
    for (const who of [o.staffId, o.instructorId, o.outsiderId]) {
      for (const t of tables) {
        expect(await q(user(who), `select * from public.${t}`), `${t} visible`).toHaveLength(0);
      }
      await expect(q(user(who), "select * from public.finance_summary($1)", [o.orgId])).rejects.toThrow(/permission/);
      await expect(q(user(who), "select * from public.finance_overdue_installments($1)", [o.orgId])).rejects.toThrow(/permission/);
    }
    // The staff member can see candidate "a" in the CRM but not their fee plan.
    expect(await q(user(o.staffId), "select id from public.candidates where id = $1", [cand.a])).toHaveLength(1);
  });

  it("staff and instructors cannot write finance rows", async () => {
    await expect(savePlan(enr.a, 1000, [], {}, user(o.staffId))).rejects.toThrow(/permission/);
    const plan = await savePlan(enr.a, 1000);
    await expect(pay(plan, 100, day(0), {}, user(o.staffId))).rejects.toThrow(/row-level security/);
    await expect(pay(plan, 100, day(0), {}, user(o.instructorId))).rejects.toThrow(/row-level security/);
    const [cat] = await q<{ id: string }>(owner(), "select id from public.expense_categories where organization_id = $1 limit 1", [o.orgId]);
    await expect(
      q(user(o.staffId), "insert into public.expenses (organization_id, category_id, spent_on, amount, description, created_by) values ($1, $2, $3, 1, 'x', $4)", [o.orgId, cat.id, day(0), o.staffId]),
    ).rejects.toThrow(/row-level security/);
    await expect(q(user(o.staffId), "select public.log_fee_reminder($1, 'whatsapp', 'opened')", [plan])).rejects.toThrow(/permission/);
  });

  it("anon has no access at all", async () => {
    for (const t of [...tables, "receipt_counters"]) {
      await expect(q({ role: "anon" }, `select 1 from public.${t}`)).rejects.toThrow(/permission denied/);
    }
    await expect(q({ role: "anon" }, "select * from public.finance_summary($1)", [o.orgId])).rejects.toThrow(/permission denied/);
    await expect(q({ role: "anon" }, "select public.record_gateway_payment('plink_x', 'pay_x', 100, 'INR', now())")).rejects.toThrow(/permission denied/);
  });

  it("owners cannot create gateway payments or mark links paid themselves", async () => {
    const plan = (await q<{ id: string }>(owner(), "select id from public.fee_plans where enrollment_id = $1", [enr.a]))[0].id;
    await expect(
      q(owner(), "insert into public.payments (organization_id, fee_plan_id, amount, currency, paid_on, method, recorded_by) values ($1, $2, 1, 'INR', $3, 'razorpay', $4)", [o.orgId, plan, day(0), o.ownerId]),
    ).rejects.toThrow(/check constraint/);
    await expect(q(owner(), "select public.record_gateway_payment('plink_x', 'pay_x', 100, 'INR', now())")).rejects.toThrow(/permission denied/);
    const [link] = await q<{ id: string }>(owner(), "insert into public.payment_links (organization_id, fee_plan_id, amount, currency, status, created_by) values ($1, $2, 500, 'INR', 'creating', $3) returning id", [
      o.orgId,
      plan,
      o.ownerId,
    ]);
    await expect(q(owner(), "update public.payment_links set status = 'paid' where id = $1", [link.id])).rejects.toThrow(/Only Razorpay/);
    await q(owner(), "update public.payment_links set status = 'created', provider_link_id = 'plink_TestLink001', short_url = 'https://rzp.io/i/test' where id = $1", [link.id]);
  });
});

describe("Razorpay webhook recording", () => {
  it("records a gateway payment once, however often the webhook is delivered", async () => {
    const plan = (await q<{ id: string }>(owner(), "select id from public.fee_plans where enrollment_id = $1", [enr.a]))[0].id;
    const svc = { role: "service_role" as const };
    const call = () =>
      q<{ r: { result: string; payment_id?: string } }>(svc, "select public.record_gateway_payment('plink_TestLink001', 'pay_TestPayment01', 50000, 'INR', now()) as r");
    const [first] = await call();
    expect(first.r.result).toBe("recorded");
    const [again] = await call();
    expect(again.r).toEqual({ result: "duplicate", payment_id: first.r.payment_id });
    const rows = await q<{ amount: string; method: string; status: string; receipt_number: string }>(owner(), "select amount, method, status, receipt_number from public.payments where gateway_payment_id = 'pay_TestPayment01'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: "500.00", method: "razorpay", status: "completed" });
    expect(rows[0].receipt_number).toMatch(/^AR-\d{4}-\d{4}$/);
    const [link] = await q<{ status: string; payment_id: string }>(owner(), "select status, payment_id from public.payment_links where provider_link_id = 'plink_TestLink001'");
    expect(link).toEqual({ status: "paid", payment_id: first.r.payment_id });
    // A second row with the same Razorpay id is impossible even outside the function.
    await expect(
      q(svc, "insert into public.payments (organization_id, fee_plan_id, amount, currency, paid_on, method, gateway, gateway_payment_id) values ($1, $2, 1, 'INR', $3, 'razorpay', 'razorpay', 'pay_TestPayment01')", [o.orgId, plan, day(0)]),
    ).rejects.toThrow(/duplicate key/);
    const [unknown] = await q<{ r: { result: string } }>(svc, "select public.record_gateway_payment('plink_Unknown0001', 'pay_TestPayment02', 100, 'INR', now()) as r");
    expect(unknown.r.result).toBe("unknown_link");
  });

  it("logs fee reminders on the timeline without amounts", async () => {
    const plan = (await q<{ id: string }>(owner(), "select id from public.fee_plans where enrollment_id = $1", [enr.a]))[0].id;
    await q(owner(), "select public.log_fee_reminder($1, 'whatsapp', 'opened')", [plan]);
    const acts = await q<{ type: string; summary: string }>(user(o.staffId), "select type, summary from public.candidate_activities where candidate_id = $1 and type = 'fee_reminder'", [cand.a]);
    expect(acts).toEqual([{ type: "fee_reminder", summary: "Fee reminder opened in WhatsApp" }]);
  });
});
