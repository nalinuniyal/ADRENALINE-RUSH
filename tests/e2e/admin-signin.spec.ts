import { expect, test } from "@playwright/test";

/**
 * Needs a real Supabase project with a completed first-admin setup.
 * Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (use a dedicated test owner in a
 * test project, never production credentials).
 */
const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;

test.describe("owner sign-in", () => {
  test.skip(!email || !password, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set");

  test("rejects a wrong password with a generic message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(`${password}-wrong`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("The email or password is incorrect.")).toBeVisible();
  });

  test("signs in, sees every module, can open settings and sign out", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business profile" })).toBeVisible();

    await page.getByLabel("Account menu").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});
