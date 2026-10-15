import { expect, test } from "@playwright/test";

test.describe("public visitors", () => {
  test("see the branded home page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Adrenaline Rush/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The admin area is reached by its URL only; public pages never link to it.
    await expect(page.locator(`a[href^="/login"], a[href^="/admin"]`)).toHaveCount(0);
  });

  for (const path of ["/admin", "/admin/settings", "/admin/finance", "/admin/candidates"]) {
    test(`are redirected away from ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%2F/g, "(%2F|/)")}`));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      // No admin content leaks into the login page.
      await expect(page.getByText("Business profile")).toHaveCount(0);
    });
  }

  test("get a raw redirect (no admin HTML) when requesting admin without following", async ({ request }) => {
    const res = await request.get("/admin/settings", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/login?next=");
    expect(await res.text()).not.toContain("Business profile");
  });

  test("receive security headers", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});

test.describe("login form", () => {
  test("validates on the server and shows accessible errors", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("health endpoint", () => {
  test("reports database status without leaking configuration", async ({ request }) => {
    const res = await request.get("/api/health");
    const body = await res.json();
    expect([200, 503]).toContain(res.status());
    expect(Object.keys(body).sort()).toEqual(res.status() === 200 ? ["database", "latencyMs", "status"] : ["database", "status"]);
    expect(JSON.stringify(body)).not.toMatch(/supabase\.co|sb_|key/i);
  });
});

test.describe("public information pages", () => {
  for (const [path, heading] of [
    ["/about", /Training that moves/],
    ["/faq", "Frequently asked questions"],
    ["/privacy", "Privacy policy"],
    ["/terms", "Terms of use"],
  ] as const) {
    test(`${path} renders`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // The admin area is reached by its URL only; public pages never link to it.
    await expect(page.locator(`a[href^="/login"], a[href^="/admin"]`)).toHaveCount(0);
    });
  }

  test("FAQ answers expand with the keyboard", async ({ page }) => {
    await page.goto("/faq");
    const first = page.locator("summary").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Registering does not commit you to pay")).toBeVisible();
  });
});

test.describe("guards for new admin pages", () => {
  for (const path of ["/admin/courses/new", "/admin/candidates/import", "/admin/search?q=test"]) {
    test(`${path} requires sign in`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain("/login?next=");
    });
  }

  test("candidate CSV export requires sign in", async ({ request }) => {
    const res = await request.get("/admin/candidates/export", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(await res.text()).not.toContain(",");
  });
});
