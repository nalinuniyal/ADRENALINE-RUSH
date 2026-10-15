import { expect, test as base, type Browser, type Page } from "@playwright/test";

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
 * Roles & access end to end, against the same fresh stack as full-flow.spec.ts
 * (run with E2E_FULL=1): the owner creates a custom "Accounts" role with only
 * finance view/manage, invites someone with it, that person sees only Finance
 * and can add expenses; the owner then takes "Record payments and expenses"
 * away and the member can no longer record anything. Each user signs in once
 * and the session is reused (login rate limit). Only fictional data.
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
const ROLE = `Accounts ${STAMP}`;
const MEMBER = { name: "Accounts Test Person", email: `accounts-${STAMP}@example.test`, password: "Accounts-Member-77x" };

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The flow mutates shared data; run it once");
});

type Cookies = Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>;
let ownerCookies: Cookies = [];
let memberCookies: Cookies = [];

async function signInOwner(page: Page) {
  if (ownerCookies.length) {
    await page.context().addCookies(ownerCookies);
    await page.goto("/admin/settings");
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

async function memberPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addCookies(memberCookies);
  return context.newPage();
}

let inviteLink = "";

test("owner creates an Accounts role with only finance permissions", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/admin/settings");
  const staffSwitch = page.getByLabel("Enable staff / counselor accounts");
  if (!(await staffSwitch.isChecked())) {
    await staffSwitch.check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
  }

  await page.getByRole("link", { name: "Manage roles & access" }).click();
  await page.waitForURL(/\/admin\/settings\/roles$/);
  await expect(page.getByRole("heading", { name: "Roles & access" })).toBeVisible();
  await expect(page.getByText("Owner only").or(page.getByText("Locked")).first()).toBeVisible();

  await page.getByRole("button", { name: "New role" }).click();
  const form = page.getByRole("form", { name: "New role" });
  await form.getByLabel("Role name").fill(ROLE);
  await form.getByLabel("Based on").selectOption("staff");
  await form.getByLabel("See the dashboard").uncheck();
  // Ticking "record" switches on "view" too.
  await form.getByLabel("Record payments and expenses").check();
  await expect(form.getByLabel("View fees and payments")).toBeChecked();
  await expect(form.getByText("Sensitive access in this role")).toBeVisible();
  await expect(form.getByText("Fee lists will look empty")).toBeVisible();
  await form.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByText(`Role “${ROLE}” created.`)).toBeVisible();
  await expect(page.getByText(ROLE, { exact: true })).toBeVisible();
});

test("owner invites someone with the custom role", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/admin/settings/team");
  await page.locator("#inv-name").fill(MEMBER.name);
  await page.locator("#inv-email").fill(MEMBER.email);
  await page.locator("#inv-role").selectOption({ label: ROLE });
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = page.locator("#invite-link");
  await expect(link).toHaveValue(/\/invite\/[A-Za-z0-9_-]{43}$/);
  inviteLink = await link.inputValue();
  await expect(page.getByRole("cell", { name: ROLE })).toBeVisible();
});

test("the member sees only Finance and can add expenses", async ({ browser }) => {
  test.skip(!inviteLink, "Needs the invitation");
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  // Path only: the link's host is NEXT_PUBLIC_SITE_URL, which may differ from the test server.
  await page.goto(new URL(inviteLink).pathname);
  await expect(page.getByText(ROLE, { exact: true })).toBeVisible();
  await page.getByLabel("Choose a password").fill(MEMBER.password);
  await page.getByLabel("Confirm password").fill(MEMBER.password);
  await page.getByRole("button", { name: /join/i }).click();
  // No dashboard permission: lands on Finance.
  await page.waitForURL(/\/admin\/finance$/);
  memberCookies = await context.cookies();

  const nav = page.getByRole("banner");
  await expect(nav.getByRole("link", { name: "Finance", exact: true })).toBeVisible();
  for (const hidden of ["Dashboard", "Courses", "Candidates", "Batches", "Calendar", "Demos", "Marketing", "Analytics", "Settings"]) {
    await expect(nav.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);
  }
  // The account menu names the custom role.
  await expect(page.getByText(`${ROLE} ·`).first()).toBeAttached();

  await page.goto("/admin/finance/expenses");
  await expect(page.getByText("Add an expense")).toBeVisible();
  for (const path of ["/admin/candidates", "/admin/settings/roles", "/admin/settings/team"]) {
    await page.goto(path);
    await expect(page.getByText("You don’t have access to this area")).toBeVisible();
  }
  await context.close();
});

test("after the owner removes recording, the member can only view", async ({ page, browser }) => {
  test.skip(!memberCookies.length, "Needs the member");
  await signInOwner(page);
  await page.goto("/admin/settings/roles");
  await page.getByRole("button", { name: `Edit ${ROLE}` }).click();
  const form = page.getByRole("form", { name: `Edit ${ROLE}` });
  await form.getByLabel("Record payments and expenses").uncheck();
  await expect(form.getByLabel("View fees and payments")).toBeChecked();
  await form.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByText(`Role “${ROLE}” saved.`)).toBeVisible();

  const member = await memberPage(browser);
  await member.goto("/admin/finance/expenses");
  await expect(member.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(member.getByText("Add an expense")).toHaveCount(0);
  await expect(member.getByText("You don’t have access to this area")).toHaveCount(0);
  await member.context().close();

  // The role is in use, so it cannot be deleted yet.
  await expect(page.getByRole("button", { name: `Delete ${ROLE}` })).toBeDisabled();
});
