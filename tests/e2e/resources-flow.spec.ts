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
 * Demos & Resources: create a resource, share it with a candidate (copy +
 * WhatsApp click-to-chat), see the activity on the timeline and open the
 * public page. Runs on the stack prepared by full-flow.spec.ts (its owner
 * and its "Riya Test" candidate), so run it after that file, e.g.
 *   E2E_FULL=1 npx playwright test full-flow resources-flow --workers=1 --project=desktop
 * Only fictional test data is used.
 */
test.skip(!process.env.E2E_FULL, "Set E2E_FULL=1 with the stack prepared by full-flow.spec.ts");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1366, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });

const OWNER = { email: "owner@example.test", password: "Correct-horse-42x" };
const TITLE = "E2E demo class recording";
let publicPath = "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin/);
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The flow mutates shared data; run it once");
});

test("owner adds a shareable demo video", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/resources");
  await page.getByRole("link", { name: "New resource" }).first().click();
  await page.waitForURL(/\/admin\/resources\/new/);
  await page.getByRole("textbox", { name: /title/i }).fill(TITLE);
  await page.locator("#url").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(page.getByText(/YouTube video: it will play inside the public page/)).toBeVisible();
  await page.getByRole("textbox", { name: /description/i }).fill("Forty minutes of a live demo class.");
  await page.getByRole("button", { name: "Save resource" }).click();
  await page.waitForURL(/\/admin\/resources\/[0-9a-f-]{36}/);
  await expect(page.getByText("Resource saved").first()).toBeVisible();
  publicPath = new URL((await page.locator("p.break-all").first().innerText()).trim()).pathname;
  expect(publicPath).toMatch(/^\/r\/e2e-demo-class-recording-[a-z0-9]+$/);
});

test("owner shares it with a candidate by copy and WhatsApp; the timeline records it", async ({ page, context }) => {
  await signIn(page);
  await page.goto("/admin/candidates");
  await page.getByRole("link", { name: "Riya Test" }).first().click();
  await page.waitForURL(/\/admin\/candidates\/[0-9a-f-]{36}/);
  const candidateUrl = page.url();
  await page.getByRole("link", { name: "Share demo/resources" }).click();
  await page.waitForURL(/\/admin\/resources\/share\?candidate=/);

  await page.getByRole("checkbox", { name: new RegExp(TITLE) }).check();
  const preview = page.getByTestId("share-preview");
  await expect(preview).toContainText("Hi Riya");
  await expect(preview).toContainText(publicPath);

  await page.getByRole("button", { name: /^Copy message/ }).click();
  await expect(page.getByText("Copied and recorded in the share history.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(publicPath);

  // Click-to-chat opens wa.me in a new tab (not reachable from the test machine, so only the URL is checked).
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ contentType: "text/html", body: "<p>WhatsApp</p>" }));
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: /Open WhatsApp/ }).click();
  const wa = await popup;
  await wa.waitForLoadState();
  expect(wa.url()).toMatch(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//);
  expect(decodeURIComponent(wa.url())).toMatch(/919876543210|Hi Riya/);
  await wa.close();
  await expect(page.getByText(/WhatsApp opened and recorded/)).toBeVisible();

  await page.goto(candidateUrl);
  await expect(page.getByText(`WhatsApp opened to share: ${TITLE}`)).toBeVisible();
  await expect(page.getByText(`Message copied to share: ${TITLE}`)).toBeVisible();

  await page.goto("/admin/resources");
  await expect(page.getByText("Shared 2×").first()).toBeVisible();
  await page.goto("/admin/resources/history");
  await expect(page.getByText("WhatsApp · not confirmed").first()).toBeVisible();
});

test("the public page shows the video and a demo call to action, without indexing", async ({ page }) => {
  await page.goto(publicPath);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await expect(page.locator('iframe[src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: /book a free demo/i }).first()).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // Unknown or internal resources are not found.
  await page.goto("/r/does-not-exist-123");
  await expect(page.getByRole("heading", { name: "This page doesn’t exist" })).toBeVisible();
});
