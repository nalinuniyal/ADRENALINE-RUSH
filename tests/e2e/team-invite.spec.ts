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
 * Team invitations end to end: owner invites a staff member, the invitee
 * accepts through the private link, signs in and sees only staff modules.
 * Runs after full-flow.spec.ts (needs its owner) with E2E_FULL=1 against a
 * Supabase-compatible stack. Only fictional example.test addresses are used.
 */
test.skip(!process.env.E2E_FULL, "Set E2E_FULL=1 with a fresh Supabase-compatible stack");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1366, height: 900 } });

const OWNER = { email: "owner@example.test", password: "Correct-horse-42x" };
const STAFF = { name: "Test Counselor", email: `counselor-${Date.now().toString(36)}@example.test`, password: "Staff-Member-77x" };

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The flow mutates shared data; run it once");
});

async function signInOwner(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin/);
}

let inviteLink = "";

test("owner switches on staff accounts and invites a counselor", async ({ page }) => {
  await signInOwner(page);
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
  const link = page.locator("#invite-link");
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
  inviteLink = await link.inputValue();
  await expect(page.getByRole("link", { name: "Share on WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  await expect(page.getByRole("button", { name: `New link for ${STAFF.name}` })).toBeVisible();
});

test("the invitee accepts, signs in and sees only staff modules", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.goto(inviteLink);
  await expect(page.getByRole("heading", { name: /^Join / })).toBeVisible();
  await expect(page.getByText("Staff / Counselor", { exact: true })).toBeVisible();

  await page.getByLabel("Choose a password").fill("short");
  await page.getByRole("button", { name: /join/i }).click();
  await expect(page.getByText("Use at least 12 characters")).toBeVisible();

  await page.getByLabel("Choose a password").fill(STAFF.password);
  await page.getByLabel("Confirm password").fill(STAFF.password);
  await page.getByRole("button", { name: /join/i }).click();
  await page.waitForURL(/\/admin$/);

  const nav = page.getByRole("banner");
  await expect(nav.getByRole("link", { name: "Candidates", exact: true })).toBeVisible();
  for (const hidden of ["Finance", "Analytics", "Settings"]) await expect(nav.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);

  for (const path of ["/admin/finance", "/admin/settings", "/admin/settings/team"]) {
    await page.goto(path);
    await expect(page.getByText("You don’t have access to this area")).toBeVisible();
  }
  await page.goto("/admin/account");
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible();

  // The link works once.
  const again = await (await browser.newContext()).newPage();
  await again.goto(inviteLink);
  await expect(again.getByRole("heading", { name: "Invitation already used" })).toBeVisible();
  await context.close();
});

test("owner suspends the counselor, who then has no access", async ({ page, browser }) => {
  await signInOwner(page);
  await page.goto("/admin/settings/team");
  page.on("dialog", (d) => d.accept());
  await page.locator("li", { hasText: STAFF.email }).getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText(/Member suspended/)).toBeVisible();

  const context = await browser.newContext();
  const staff = await context.newPage();
  await staff.goto("/login");
  await staff.getByLabel("Email").fill(STAFF.email);
  await staff.getByLabel("Password").fill(STAFF.password);
  await staff.getByRole("button", { name: "Sign in" }).click();
  await staff.waitForURL(/\/no-access/);
  await context.close();
});
