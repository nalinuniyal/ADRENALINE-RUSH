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
 * Analytics end to end (spec scenario 17: dashboard totals reconcile with the
 * underlying transactions). Records a payment, a refund and an expense, then
 * checks that Analytics shows the same money as Payments & Expenses for the
 * same period, and that the change equals what was recorded. Run with
 * E2E_FULL=1 against the same fresh stack as full-flow.spec.ts. Fictional data only.
 */
test.skip(!process.env.E2E_FULL, "Set E2E_FULL=1 with a fresh Supabase-compatible stack");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1366, height: 900 } });

const OWNER = {
  email: process.env.E2E_OWNER_EMAIL ?? "owner@example.test",
  passwords: process.env.E2E_OWNER_PASSWORD ? [process.env.E2E_OWNER_PASSWORD] : ["Correct-horse-42x", "Reset-by-script-77"],
};
const STAMP = Date.now().toString(36);
const COURSE = `Analytics Flow Course ${STAMP}`;
const CANDIDATE = `Analytics Flow Student ${STAMP}`;
const BATCH = `Analytics Flow ${STAMP}`;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The flow mutates shared data; run it once");
});

// Sign in once and reuse the session cookies (the login rate limit is 8 per 15 minutes).
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

/** "₹12,500.50" / "-₹2,500" → 12500.5 / -2500 */
async function money(page: Page, testId: string): Promise<number> {
  const text = (await page.getByTestId(testId).first().innerText()).trim();
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return text.includes("-") || text.includes("−") ? -Math.abs(n) : n;
}

type Totals = { net: number; expenses: number; cash: number; outstanding: number };

async function analyticsTotals(page: Page): Promise<Totals & { financeHref: string }> {
  await page.goto("/admin/analytics?range=this_month");
  const financeHref = (await page.getByTestId("analytics-kpi-net-collections").locator("xpath=ancestor::a").getAttribute("href")) ?? "";
  return {
    net: await money(page, "analytics-kpi-net-collections"),
    expenses: await money(page, "analytics-kpi-expenses"),
    cash: await money(page, "analytics-kpi-cash-result"),
    outstanding: await money(page, "analytics-kpi-outstanding"),
    financeHref,
  };
}

async function financeTotals(page: Page, href: string): Promise<Totals> {
  await page.goto(href);
  return {
    net: await money(page, "kpi-net-collections"),
    expenses: await money(page, "kpi-expenses"),
    cash: await money(page, "kpi-cash-result"),
    outstanding: await money(page, "kpi-outstanding-fees"),
  };
}

test("scenario 17: analytics totals reconcile with recorded payments, refunds and expenses", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);

  const before = await analyticsTotals(page);
  expect(before.financeHref).toMatch(/^\/admin\/finance\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  // Same period, same numbers, before anything is recorded.
  const { financeHref, ...beforeTotals } = before;
  expect(await financeTotals(page, financeHref)).toEqual(beforeTotals);

  // Course, candidate, batch and enrollment.
  await page.goto("/admin/courses/new");
  await page.getByLabel("Course title").fill(COURSE);
  await page.getByRole("button", { name: /from title/i }).click();
  await page.getByLabel("Short description").fill("Course used by the analytics end-to-end test.");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}/);

  await page.goto("/admin/candidates/new");
  await page.getByLabel("Full name").fill(CANDIDATE);
  await page.getByLabel("Email").first().fill(`analytics-flow-${STAMP}@example.test`);
  await page.getByRole("button", { name: /create|save|add/i }).first().click();
  await page.waitForURL(/\/admin\/candidates\/[0-9a-f-]{36}/);

  await page.goto("/admin/batches/new");
  await page.locator("#courseId").selectOption({ label: `${COURSE} (draft)` });
  await page.locator("#name").fill(BATCH);
  await page.locator("#status").selectOption("open");
  await page.getByRole("button", { name: "Create batch" }).click();
  await page.waitForURL(/\/admin\/batches\/[0-9a-f-]{36}\?created=1/);
  const batchId = page.url().split("?")[0].split("/").pop() ?? "";
  await page.getByLabel("Find a candidate").fill(CANDIDATE);
  await page.getByRole("button", { name: `Enroll ${CANDIDATE}` }).click();
  await expect(page.getByText("Enrolled.")).toBeVisible();

  // Fee plan, a payment and a refund.
  await page.goto(`/admin/finance/fees?batch=${batchId}`);
  await page.getByRole("link", { name: CANDIDATE }).click();
  await page.waitForURL(/\/admin\/finance\/fees\/[0-9a-f-]{36}$/);
  const feesUrl = page.url();
  await page.getByLabel("Agreed course fee").fill("20000");
  await page.getByRole("button", { name: "Save fee plan" }).click();
  await expect(page.getByText("Fee plan saved.")).toBeVisible();
  await page.reload();
  await page.locator("#pay-amount").fill("12000");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/Payment of ₹12,000 recorded\./)).toBeVisible();
  await page.goto(feesUrl);
  await page.getByRole("button", { name: "Refund" }).first().click();
  await page.locator('[id^="ref-amt-"]').first().fill("2000");
  await page.locator('[id^="ref-reason-"]').first().fill("Synthetic analytics refund");
  await page.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refund recorded.")).toBeVisible();

  // An expense.
  await page.goto("/admin/finance/expenses");
  if (!(await page.locator("#new-cat").isVisible())) await page.getByText("Add an expense").click();
  await page.locator("#new-cat").selectOption({ label: "Venue" });
  await page.locator("#new-amount").fill("1500.25");
  await page.locator("#new-desc").fill(`Analytics room hire ${STAMP}`);
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(page.getByText(/Expense of ₹1,500\.25 recorded\./)).toBeVisible();

  const after = await analyticsTotals(page);
  const { financeHref: afterHref, ...afterTotals } = after;
  expect(afterHref).toBe(financeHref);
  expect(await financeTotals(page, afterHref)).toEqual(afterTotals);

  // The change is exactly what was recorded.
  expect(after.net - before.net).toBe(10000);
  expect(after.expenses - before.expenses).toBeCloseTo(1500.25, 2);
  expect(after.cash - before.cash).toBeCloseTo(10000 - 1500.25, 2);
  expect(after.outstanding - before.outstanding).toBe(10000);

  // The course appears in course performance with its net collections.
  await page.goto("/admin/analytics?range=this_month");
  const row = page.getByRole("row", { name: new RegExp(COURSE) });
  await expect(row).toContainText("₹10,000");

  // And the course performance CSV downloads.
  const res = await page.request.get("/admin/analytics/reports/course-performance?range=this_month");
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain(`${COURSE},draft,0,0,1,,12000.00,2000.00,10000.00,10000.00,INR`);
});
