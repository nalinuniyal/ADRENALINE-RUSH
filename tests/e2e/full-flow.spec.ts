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
 * End-to-end business flow against a real Supabase Auth + PostgREST stack.
 * Needs a FRESH database (setup not yet done) and the app built with that
 * stack's keys plus ADMIN_SETUP_TOKEN. Run with E2E_FULL=1. In this repo's
 * cloud container: scripts/local-supabase/up.sh provides the stack.
 * Only fictional test data (example.test addresses) is used.
 */
test.skip(!process.env.E2E_FULL, "Set E2E_FULL=1 with a fresh Supabase-compatible stack");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1366, height: 900 } });

const OWNER = { email: "owner@example.test", password: "Correct-horse-42x" };
const COURSE = "Salesforce Admin Bootcamp";
const SLUG = "salesforce-admin-bootcamp";

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

test("first-time setup creates the business and owner", async ({ page }) => {
  await page.goto("/setup");
  // Production build without ADMIN_SETUP_TOKEN: ownership is proven with the Supabase secret key.
  await page.getByLabel(process.env.ADMIN_SETUP_TOKEN ? "Setup token" : "Supabase secret key").fill(process.env.ADMIN_SETUP_TOKEN || process.env.SUPABASE_SECRET_KEY || "");
  await page.getByLabel("Business name").fill("Adrenaline Rush");
  await page.getByLabel("Your full name").fill("Test Owner");
  await page.getByLabel("Your email").fill(OWNER.email);
  await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Confirm password").fill(OWNER.password);
  await page.getByRole("button", { name: /create|set up/i }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  // Setup only works once. (The page streams, so the not-found UI arrives with HTTP 200.)
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "This page doesn’t exist" })).toBeVisible();
  await expect(page.getByLabel(/setup token|secret key/i)).toHaveCount(0);
});

test("owner creates, builds and publishes a course", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/courses/new");
  await page.getByLabel("Course title").fill(COURSE);
  await page.getByRole("button", { name: /from title/i }).click();
  await expect(page.getByLabel("URL slug")).toHaveValue(SLUG);
  await page.getByLabel("Short description").fill("Live, project-based Salesforce administration.");
  await page.getByLabel("List price").fill("24999");
  await page.getByLabel("Discounted price").fill("19999");
  await page.getByRole("button", { name: /add suggested items/i }).click();
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}/);

  // Curriculum
  await page.getByRole("link", { name: /curriculum/i }).first().click();
  const editor = page.getByRole("textbox", { name: "Curriculum" });
  await editor.fill("## Getting started\n- Org setup (45m)\n- Users and profiles (1h)\n## Automation\n- Flows (90m)");
  await page.getByRole("button", { name: /save curriculum/i }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  await page.getByRole("button", { name: /^publish/i }).click();
  await expect(page.getByText(/published/i).first()).toBeVisible();
});

test("visitor registers through the public form; duplicate is linked, not duplicated", async ({ page }) => {
  await page.goto("/courses");
  await page.getByRole("link", { name: new RegExp(COURSE) }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: COURSE })).toBeVisible();
  await expect(page.getByText("Users and profiles")).toBeVisible();
  await expect(page.getByText(/19,999/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /what.s included/i })).toBeVisible();
  await expect(page.getByText("Interview practice").first()).toBeVisible();

  for (const phone of ["+91 98765 43210", "9876543210"]) {
    await page.goto(`/courses/${SLUG}`);
    await page.getByRole("textbox", { name: /full name/i }).fill("Riya Test");
    await page.getByRole("textbox", { name: /email address/i }).fill(phone.startsWith("+") ? "riya@example.test" : "RIYA@example.test");
    await page.getByRole("textbox", { name: /phone/i }).fill(phone);
    await page.getByRole("checkbox", { name: /privacy policy/i }).check();
    // Humans take a few seconds to fill a form; the server rejects instant bots.
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: /book|register|submit/i }).click();
    await page.waitForURL(new RegExp(`/courses/${SLUG}/thank-you`));
  }
});

test("demo booking emails reach the candidate and the team", async () => {
  test.skip(!process.env.E2E_MAIL_FILE, "Needs the local SMTP sink (E2E_MAIL_FILE)");
  const { readFileSync } = await import("node:fs");
  await expect
    .poll(() => readFileSync(process.env.E2E_MAIL_FILE!, "utf8").trim().split("\n").filter(Boolean).length, { timeout: 15000 })
    .toBeGreaterThanOrEqual(4);
  const mails = readFileSync(process.env.E2E_MAIL_FILE!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { to: string[]; data: string });
  const toCandidate = mails.filter((m) => m.to.some((t) => /riya@example\.test/i.test(t)));
  const toTeam = mails.filter((m) => m.to.some((t) => /owner@example\.test/i.test(t)));
  // Two bookings (the second is the same person again): each sends one email to each side.
  expect(toCandidate).toHaveLength(2);
  expect(toTeam).toHaveLength(2);
  expect(toCandidate[0].data).toContain(COURSE.split(" ")[0]);
});

test("owner edits an email template with an image and sees the email log", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/marketing/emails");
  await page.getByRole("link", { name: /demo booking confirmation/i }).first().click();
  await page.waitForURL(/\/templates\//);
  await page.waitForTimeout(500);
  const subject = page.getByRole("textbox", { name: /^\*?Subject$/ });
  await subject.fill("You're booked: {{course_title}} demo");
  // 1x1 PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Upload image" }).click();
  await expect(page.frameLocator("iframe").first().locator('img[src*="/media/"]').first()).toBeAttached({ timeout: 10000 });
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  const img = page.frameLocator("iframe").first().locator('img[src*="/media/"]').first();
  const src = await img.getAttribute("src");
  expect(src).toBeTruthy();
  const media = await page.request.get(src!);
  expect(media.status()).toBe(200);
  expect(media.headers()["content-type"]).toBe("image/png");

  await page.goto("/admin/marketing/emails/log");
  await expect(page.getByText("Sent").first()).toBeVisible();
});

test("website settings drive the public footer", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/settings/website");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("hello@example.test");
  await page.getByRole("textbox", { name: "Footer tagline" }).fill("Learn Marketing Cloud the practical way.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByText("Learn Marketing Cloud the practical way.")).toBeVisible();
  await expect(footer.getByRole("link", { name: /hello@example\.test/ })).toBeVisible();
});

test("owner works the lead in the CRM", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/candidates");
  const rows = page.getByRole("link", { name: "Riya Test" });
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await page.waitForURL(/\/admin\/candidates\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Course registrations (2)" })).toBeVisible();
  await expect(page.getByText("Repeat registration")).toBeVisible();

  const path = page.getByRole("list", { name: "Lead status path" }).or(page.getByLabel("Lead status path"));
  await path.getByRole("button", { name: /contacted/i }).click();
  await expect(path.getByRole("button", { name: /contacted/i })).toHaveAttribute("aria-current", /step|true/);

  await page.getByLabel("Add a note").fill("Called, interested in the weekend batch.");
  await page.getByRole("button", { name: /add note/i }).click();
  await expect(page.getByText("Called, interested in the weekend batch.")).toBeVisible();

  await page.getByLabel("What needs to happen?").fill("Send fee details");
  await page.getByRole("button", { name: "Schedule follow-up" }).click();
  await expect(page.getByText("Send fee details").first()).toBeVisible();
});

test("export, search and import", async ({ page }) => {
  await signIn(page);
  const res = await page.request.get("/admin/candidates/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain("riya@example.test");

  await page.goto("/admin/search?q=riya");
  await expect(page.getByRole("link", { name: /Riya Test/ })).toBeVisible();

  await page.goto("/admin/candidates/import");
  const csv = "Name,Email,Phone\nArjun Test,arjun@example.test,9123456780\nRiya Again,riya@example.test,\nBad Row,,\n";
  await page.locator('input[type="file"]').setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /^import/i }).last().click();
  await expect(page.getByRole("heading", { name: "Import finished" })).toBeVisible();
  // One new, one already known (same email as the registration), one with no email or phone.
  await expect(page.getByRole("status")).toContainText(/1\s*Created\s*1\s*Skipped as duplicates\s*1\s*Invalid/);
  await page.goto("/admin/candidates");
  await expect(page.getByRole("link", { name: "Arjun Test" })).toBeVisible();
});

test("sign out ends the session", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Account menu").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});

test("npm run admin:password resets a forgotten password", async ({ page }) => {
  const { execFileSync } = await import("node:child_process");
  const newPassword = "Reset-by-script-77";
  execFileSync("node", ["scripts/admin-password.mjs"], { env: { ...process.env, ADMIN_EMAIL: OWNER.email, ADMIN_PASSWORD: newPassword }, stdio: "pipe" });
  await page.goto("/admin");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  // ...and the owner can change it back from Settings.
  await page.goto("/admin/settings#sign-in");
  await page.getByLabel("Current password").fill(newPassword);
  await page.getByLabel("New password", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Repeat new password").fill(OWNER.password);
  await page.getByRole("button", { name: "Update sign-in details" }).click();
  await expect(page.getByText("Password updated.")).toBeVisible();
});
