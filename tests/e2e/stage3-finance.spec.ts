import { expect, test as base, type Page } from "@playwright/test";

// Wait for hydration before typing, as a person would.
const test = base.extend({
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, opts) => {
      const res = await goto(url, opts);
      await page.waitForLoadState("load");
      await page.waitForTimeout(400);
      return res;
    };
    await provide(page);
  },
});

/**
 * Finance end to end (spec scenarios 13–16 and 18), against the same fresh
 * stack as full-flow.spec.ts (run with E2E_FULL=1). Signs in as full-flow's
 * owner, creates its own course, candidate, batch and enrollment, and reads
 * the overview filtered to its own batch so other data does not interfere.
 * Only fictional data.
 */
test.skip(!process.env.E2E_FULL, "Set E2E_FULL=1 with a fresh Supabase-compatible stack");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1366, height: 900 } });

// E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD let the spec run against an existing local stack.
const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner@example.test",
  passwords: process.env.E2E_OWNER_PASSWORD ? [process.env.E2E_OWNER_PASSWORD] : ["Correct-horse-42x", "Reset-by-script-77"],
};
const STAMP = Date.now().toString(36);
const COURSE = `Finance Flow Course ${STAMP}`;
const CANDIDATE = `Finance Flow Student ${STAMP}`;
const BATCH = `Finance Flow ${STAMP}`;
const STAFF = { name: "Finance Test Counselor", email: `fin-counselor-${STAMP}@example.test`, password: "Staff-Member-77x" };

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The flow mutates shared data; run it once");
});

// Sign in once and reuse the session cookies, so the login rate limit is not hit.
let ownerCookies: Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> = [];
async function signIn(page: Page) {
  if (ownerCookies.length) {
    await page.context().addCookies(ownerCookies);
    await page.goto("/admin");
    if (new URL(page.url()).pathname.startsWith("/admin")) return;
  }
  for (let attempt = 0; attempt < 24; attempt++) {
    for (const password of OWNER.passwords) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(OWNER.email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      const ok = await page
        .waitForURL(/\/admin/, { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (ok) {
        ownerCookies = await page.context().cookies();
        return;
      }
    }
    await page.waitForTimeout(5_000);
  }
  throw new Error("The owner account never became available");
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => isoDate(new Date(Date.now() + n * 864e5));
/** "₹12,500.50" / "-₹2,500" → 12500.5 / -2500 */
async function money(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).first().innerText()).trim();
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return text.includes("-") || text.includes("−") ? -Math.abs(n) : n;
}

let batchId = "";
let feesUrl = "";
let receiptUrl = "";

test("setup: owner creates a course, a candidate and a batch, and enrolls the candidate", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/admin/courses/new");
  await page.getByLabel("Course title").fill(COURSE);
  await page.getByRole("button", { name: /from title/i }).click();
  await page.getByLabel("Short description").fill("Course used by the finance end-to-end test.");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}/);

  await page.goto("/admin/candidates/new");
  await page.getByLabel("Full name").fill(CANDIDATE);
  await page.getByLabel("Email").first().fill(`finance-flow-${STAMP}@example.test`);
  await page.getByRole("button", { name: /create|save|add/i }).first().click();
  await page.waitForURL(/\/admin\/candidates\/[0-9a-f-]{36}/);

  await page.goto("/admin/batches/new");
  await page.locator("#courseId").selectOption({ label: `${COURSE} (draft)` });
  await page.locator("#name").fill(BATCH);
  await page.locator("#status").selectOption("open");
  await page.getByRole("button", { name: "Create batch" }).click();
  await page.waitForURL(/\/admin\/batches\/[0-9a-f-]{36}\?created=1/);
  batchId = page.url().split("?")[0].split("/").pop() ?? "";

  await page.getByLabel("Find a candidate").fill(CANDIDATE);
  await page.getByRole("button", { name: `Enroll ${CANDIDATE}` }).click();
  await expect(page.getByText("Enrolled.")).toBeVisible();
});

test("scenario 13 + 14: fee plan with installments, a partial payment and a receipt", async ({ page }) => {
  test.skip(!batchId, "Needs the setup step");
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto(`/admin/finance/fees?batch=${batchId}`);
  await page.getByRole("link", { name: CANDIDATE }).click();
  await page.waitForURL(/\/admin\/finance\/fees\/[0-9a-f-]{36}$/);
  feesUrl = page.url();

  await page.getByLabel("Agreed course fee").fill("30000");
  await expect(page.getByTestId("final-fee")).toHaveText("₹30,000");
  await page.getByLabel("Split into").fill("3");
  await page.getByLabel("First due").fill(daysFromNow(-45));
  await page.getByRole("button", { name: "Split evenly" }).click();
  await expect(page.getByText("matches the final fee")).toBeVisible();
  await page.getByRole("button", { name: "Save fee plan" }).click();
  await expect(page.getByText("Fee plan saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("outstanding")).toHaveText("₹30,000");

  // Scenario 13: a payment is recorded (with a receipt number).
  await page.locator("#pay-amount").fill("15000");
  await page.getByLabel("Reference / UTR / cheque no.").fill(`UTR${STAMP}`);
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/Payment of ₹15,000 recorded\. Receipt AR-\d{4}-\d{4,}\./)).toBeVisible();
  await page.reload();

  // Scenario 14: the partial payment fills installment 1 and half of installment 2.
  await expect(page.getByTestId("installment-1").getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByTestId("installment-2").getByText("Overdue")).toBeVisible();
  await expect(page.getByTestId("installment-2")).toContainText("paid ₹5,000");
  await expect(page.getByTestId("installment-3").getByText("Due", { exact: true })).toBeVisible();
  await expect(page.getByTestId("outstanding")).toHaveText("₹15,000");
  await expect(page.getByTestId("net-paid")).toHaveText("₹15,000");

  const receipt = page.getByRole("link", { name: /^AR-\d{4}-\d{4,}$/ }).first();
  receiptUrl = new URL((await receipt.getAttribute("href")) ?? "", page.url()).toString();
  await receipt.click();
  await expect(page.getByTestId("receipt-number")).toHaveText(/^AR-\d{4}-\d{4,}$/);
  const article = page.getByRole("article", { name: /^Receipt AR-/ });
  await expect(article.getByText(CANDIDATE)).toBeVisible();
  await expect(article.getByText("₹15,000").first()).toBeVisible();

  // The overdue installment appears on the overview with reminder buttons.
  await page.goto(`/admin/finance?batch=${batchId}`);
  await expect(page.getByRole("link", { name: CANDIDATE }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "WhatsApp reminder" }).first()).toBeVisible();
});

test("scenario 15: a refund reduces net collections", async ({ page }) => {
  test.skip(!feesUrl, "Needs the payment step");
  await signIn(page);
  await page.goto(`/admin/finance?batch=${batchId}`);
  const grossBefore = await money(page, "kpi-gross-collections");
  const netBefore = await money(page, "kpi-net-collections");
  expect(grossBefore).toBe(15000);

  await page.goto(feesUrl);
  await page.getByRole("button", { name: "Refund" }).first().click();
  await page.locator('[id^="ref-amt-"]').first().fill("16000");
  await page.locator('[id^="ref-reason-"]').first().fill("Partial withdrawal, synthetic test");
  await page.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText(/Refunds cannot exceed the payment/)).toBeVisible();
  await page.locator('[id^="ref-amt-"]').first().fill("5000");
  await page.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refund recorded.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("net-paid")).toHaveText("₹10,000");
  await expect(page.getByTestId("outstanding")).toHaveText("₹20,000");

  await page.goto(`/admin/finance?batch=${batchId}`);
  expect(await money(page, "kpi-gross-collections")).toBe(grossBefore);
  expect(await money(page, "kpi-refunds")).toBe(5000);
  expect(await money(page, "kpi-net-collections")).toBe(netBefore - 5000);
});

test("scenario 16: an expense changes the cash result", async ({ page }) => {
  test.skip(!batchId, "Needs the setup step");
  await signIn(page);
  await page.goto(`/admin/finance?batch=${batchId}`);
  const cashBefore = await money(page, "kpi-cash-result");
  const net = await money(page, "kpi-net-collections");
  expect(cashBefore).toBe(net);

  await page.goto("/admin/finance/expenses");
  if (!(await page.locator("#new-cat").isVisible())) await page.getByText("Add an expense").click();
  await page.locator("#new-cat").selectOption({ label: "Venue" });
  await page.locator("#new-amount").fill("2500.50");
  await page.locator("#new-desc").fill(`Room hire ${STAMP}`);
  await page.locator("#new-batch").selectOption({ label: `${BATCH} — ${COURSE}` });
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText(/Expense of ₹2,500\.50 recorded\./)).toBeVisible();

  await page.goto(`/admin/finance?batch=${batchId}`);
  expect(await money(page, "kpi-expenses")).toBe(2500.5);
  expect(await money(page, "kpi-cash-result")).toBeCloseTo(cashBefore - 2500.5, 2);
});

test("scenario 18: a staff member cannot view payment records", async ({ page, browser }) => {
  test.skip(!feesUrl || !receiptUrl, "Needs the payment step");
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/admin/settings");
  const staffSwitch = page.getByLabel("Enable staff / counselor accounts");
  if (!(await staffSwitch.isChecked())) {
    await staffSwitch.check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
  }
  await page.goto("/admin/settings/team");
  await page.locator("#inv-name").fill(STAFF.name);
  await page.locator("#inv-email").fill(STAFF.email);
  await page.locator("#inv-role").selectOption("staff");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const inviteLink = await page.locator("#invite-link").inputValue();

  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const staff = await context.newPage();
  await staff.goto(inviteLink);
  await staff.getByLabel("Choose a password").fill(STAFF.password);
  await staff.getByLabel("Confirm password").fill(STAFF.password);
  await staff.getByRole("button", { name: /join/i }).click();
  await staff.waitForURL(/\/admin$/);

  for (const url of ["/admin/finance", "/admin/finance/payments", "/admin/finance/fees", "/admin/finance/expenses", new URL(feesUrl).pathname, new URL(receiptUrl).pathname]) {
    await staff.goto(url);
    await expect(staff.getByText("You don’t have access to this area")).toBeVisible();
    await expect(staff.getByText(/AR-\d{4}-\d{4,}/)).toHaveCount(0);
  }
  for (const url of ["/admin/finance/payments/export", "/admin/finance/expenses/export"]) {
    const res = await staff.request.get(url);
    expect(res.status()).toBe(403);
  }
  await context.close();
});
