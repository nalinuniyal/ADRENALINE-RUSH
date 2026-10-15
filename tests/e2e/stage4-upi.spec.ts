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
 * UPI / bank transfer payments end to end, against the same fresh
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
const COURSE = `UPI Flow Course ${STAMP}`;
const CANDIDATE = `UPI Flow Student ${STAMP}`;
const BATCH = `UPI Flow ${STAMP}`;
const UTR = String(Date.now()).slice(-12);

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

let feesUrl = "";
let payUrl = "";

test("owner saves UPI and bank details", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/settings/payments");
  await page.getByLabel("UPI ID", { exact: true }).fill("test.academy@okhdfcbank");
  await page.getByLabel("Payee name", { exact: true }).fill("Test Academy");
  await page.getByLabel("Account holder name", { exact: true }).fill("Test Academy");
  await page.getByLabel("Account number", { exact: true }).fill("123456789012");
  await page.getByLabel("IFSC", { exact: true }).fill("hdfc0001234");
  await expect(page.getByTestId("payment-preview")).toContainText("test.academy@okhdfcbank");
  await expect(page.getByTestId("payment-preview").getByRole("img", { name: /UPI QR/ })).toBeVisible();
  const save = page.getByRole("button", { name: "Save payment details" });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText("Payment details saved.")).toBeVisible();
  }
});

test("owner sets a fee and makes a pay link", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/admin/courses/new");
  await page.getByLabel("Course title").fill(COURSE);
  await page.getByRole("button", { name: /from title/i }).click();
  await page.getByLabel("Short description").fill("Course used by the UPI end-to-end test.");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}/);

  await page.goto("/admin/candidates/new");
  await page.getByLabel("Full name").fill(CANDIDATE);
  await page.getByLabel("Email").first().fill(`upi-flow-${STAMP}@example.test`);
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

  await page.goto(`/admin/finance/fees?batch=${batchId}`);
  await page.getByRole("link", { name: CANDIDATE }).click();
  await page.waitForURL(/\/admin\/finance\/fees\/[0-9a-f-]{36}$/);
  feesUrl = page.url();
  await page.getByLabel("Agreed course fee").fill("15000");
  await page.getByLabel("Split into").fill("3");
  await page.getByLabel("First due").fill(daysFromNow(-10));
  await page.getByRole("button", { name: "Split evenly" }).click();
  await page.getByRole("button", { name: "Save fee plan" }).click();
  await expect(page.getByText("Fee plan saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("outstanding")).toHaveText("₹15,000");

  await page.getByRole("button", { name: "Make pay link" }).click();
  await expect(page.getByText(/Pay link ready/)).toBeVisible();
  payUrl = (await page.getByTestId("pay-link-url").innerText()).trim();
  expect(payUrl).toMatch(/\/pay\/[A-Za-z0-9_-]{43}$/);
});

test("candidate opens the link, sees the QR with the amount and reports the UTR", async ({ browser }) => {
  test.skip(!payUrl, "Needs the pay link");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(new URL(payUrl).pathname);
  await expect(page.getByTestId("pay-amount")).toHaveText("₹5,000");
  await expect(page.getByTestId("upi-qr")).toBeVisible();
  await expect(page.getByTestId("upi-app-link")).toHaveAttribute("href", /^upi:\/\/pay\?pa=test\.academy@okhdfcbank&pn=Test%20Academy&am=5000\.00&cu=INR&tn=/);
  await expect(page.getByText("123456789012")).toBeVisible();
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  await page.getByRole("textbox", { name: /UTR/ }).fill(UTR);
  await page.getByRole("button", { name: /I’ve paid/ }).click();
  await expect(page.getByTestId("proof-sent")).toBeVisible();
  // Reporting the same UTR twice is refused.
  await page.reload();
  await page.getByRole("textbox", { name: /UTR/ }).fill(UTR);
  await page.getByRole("button", { name: /I’ve paid/ }).click();
  await expect(page.getByText(/already been sent to us/).first()).toBeVisible();
  await ctx.close();
});

test("owner approves; the payment, receipt and lower balance appear", async ({ page }) => {
  test.skip(!feesUrl || !payUrl, "Needs the earlier steps");
  await signIn(page);
  await page.goto(feesUrl);
  await expect(page.getByTestId("outstanding")).toHaveText("₹15,000");
  await expect(page.getByTestId("pending-reports-badge")).toHaveText("1 to verify");
  await page.goto("/admin/finance");
  await expect(page.getByTestId("to-verify-banner")).toBeVisible();

  await page.goto("/admin/finance/verify");
  const row = page.getByTestId("submission-row").filter({ hasText: UTR });
  await row.getByRole("button", { name: "Approve" }).click();
  await row.getByRole("button", { name: "Confirm and record payment" }).click();
  await expect(page.getByText(/Approved\. Payment recorded with receipt AR-\d{4}-\d{4,}/)).toBeVisible();

  await page.goto(feesUrl);
  await expect(page.getByTestId("outstanding")).toHaveText("₹10,000");
  const pay = page.getByTestId("payment-row").filter({ hasText: `Ref ${UTR}` });
  await expect(pay).toContainText("₹5,000");
  await expect(pay.getByRole("link", { name: /^AR-\d{4}-\d{4,}$/ })).toBeVisible();
});
