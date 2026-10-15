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
 * Batches → enrollment → classes → attendance, against the same fresh stack
 * as full-flow.spec.ts (run with E2E_FULL=1). It signs in as the owner that
 * full-flow's setup step creates, so it waits for that owner to exist.
 * It creates its own course, candidate and batch. Only fictional data.
 */
test.skip(!process.env.E2E_FULL, "Set E2E_FULL=1 with a fresh Supabase-compatible stack");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1366, height: 900 } });

const OWNER = { email: "owner@example.test", passwords: ["Correct-horse-42x", "Reset-by-script-77"] };
const STAMP = Date.now().toString(36);
const COURSE = `Batch Flow Course ${STAMP}`;
const CANDIDATE = `Batch Flow Student ${STAMP}`;
const BATCH = `Batch Flow ${STAMP}`;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The flow mutates shared data; run it once");
});

/** Signs in, waiting (up to ~2 minutes) for full-flow's first-time setup to have created the owner. */
async function signIn(page: Page) {
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
      if (ok) return;
    }
    await page.waitForTimeout(5_000);
  }
  throw new Error("The owner account never became available");
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

let batchUrl = "";

test("owner creates a course, a candidate and a batch, and enrolls the candidate", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  await page.goto("/admin/courses/new");
  await page.getByLabel("Course title").fill(COURSE);
  await page.getByRole("button", { name: /from title/i }).click();
  await page.getByLabel("Short description").fill("Course used by the batches end-to-end test.");
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}/);

  await page.goto("/admin/candidates/new");
  await page.getByLabel("Full name").fill(CANDIDATE);
  await page.getByLabel("Email").first().fill(`batch-flow-${STAMP}@example.test`);
  await page.getByRole("button", { name: /create|save|add/i }).first().click();
  await page.waitForURL(/\/admin\/candidates\/[0-9a-f-]{36}/);

  await page.goto("/admin/batches/new");
  await page.locator("#courseId").selectOption({ label: `${COURSE} (draft)` });
  await page.locator("#name").fill(BATCH);
  await page.locator("#status").selectOption("open");
  await page.locator("#capacity").fill("5");
  await page.getByRole("checkbox", { name: "Saturday" }).check();
  await page.getByRole("checkbox", { name: "Sunday" }).check();
  await page.locator("#startTime").fill("11:00");
  await page.locator("#endTime").fill("13:00");
  await page.getByRole("button", { name: "Create batch" }).click();
  await page.waitForURL(/\/admin\/batches\/[0-9a-f-]{36}\?created=1/);
  batchUrl = page.url().split("?")[0];

  await page.getByLabel("Find a candidate").fill(CANDIDATE);
  await page.getByRole("button", { name: `Enroll ${CANDIDATE}` }).click();
  await expect(page.getByText("Enrolled.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: CANDIDATE }).first()).toBeVisible();
});

test("owner generates classes from the batch schedule", async ({ page }) => {
  test.skip(!batchUrl, "Needs the batch from the previous step");
  await signIn(page);
  await page.goto(batchUrl);
  await page.locator("#gen-start").fill(isoDate(new Date()));
  await page.getByLabel("For N weeks").check();
  await page.getByLabel("Number of weeks").fill("2");
  await page.getByRole("button", { name: "Generate classes" }).click();
  await expect(page.getByText(/classes? added/)).toBeVisible();
  // Generating again adds nothing new.
  await page.getByRole("button", { name: "Generate classes" }).click();
  await expect(page.getByText(/No new classes|already|0 classes/i)).toBeVisible();
});

test("a class with a manual meeting link gets attendance and the batch shows 100%", async ({ page }) => {
  test.skip(!batchUrl, "Needs the batch from the previous step");
  await signIn(page);
  const batchId = batchUrl.split("/").pop();
  const yesterday = isoDate(new Date(Date.now() - 24 * 3600_000));

  await page.goto(`/admin/calendar/sessions/new?batch=${batchId}`);
  await page.locator("#title").fill("Extra doubt-clearing class");
  await page.locator("#date").fill(yesterday);
  await page.locator("#startTime").fill("19:00");
  await page.locator("#endTime").fill("20:00");
  await page.getByText("Paste a link").click();
  await page.locator("#meetingUrl").fill("https://meet.example.test/abc-defg-hij");
  await page.getByRole("button", { name: "Create session" }).click();
  await page.waitForURL(/\/admin\/calendar\/sessions\/[0-9a-f-]{36}/);
  await expect(page.getByRole("link", { name: /meet\.example\.test/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "Mark all present" }).click();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(page.getByText(/Attendance saved/)).toBeVisible();

  await page.goto(batchUrl);
  await expect(page.getByText("100%").first()).toBeVisible();

  await page.goto(`/admin/calendar?view=week&date=${yesterday}`);
  await expect(page.getByText("Extra doubt-clearing class").first()).toBeVisible();
});
