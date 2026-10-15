import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasAny, NAV_ITEMS, PERMISSIONS, visibleNav } from "./permissions";

describe("permission catalog", () => {
  it("matches the keys seeded by the database migration", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261014000001_foundation.sql"), "utf8");
    const block = sql.slice(sql.indexOf("insert into public.permissions"), sql.indexOf("-- Owner implicitly"));
    const keys = [...block.matchAll(/\('([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual([...PERMISSIONS].sort());
  });

  it("only references known permissions in navigation", () => {
    for (const item of NAV_ITEMS) for (const p of item.requires) expect(PERMISSIONS).toContain(p);
  });
});

describe("hasAny / visibleNav", () => {
  it("treats an empty requirement as allowed", () => {
    expect(hasAny([], [])).toBe(true);
  });

  it("hides finance, analytics and settings from a staff-like permission set", () => {
    const staff = ["dashboard.view", "courses.view", "candidates.view_assigned", "candidates.manage", "resources.view", "batches.view", "sessions.view", "marketing.view"];
    const labels = visibleNav(staff).map((i) => i.href);
    expect(labels).toContain("/admin/candidates");
    expect(labels).not.toContain("/admin/finance");
    expect(labels).not.toContain("/admin/analytics");
    expect(labels).not.toContain("/admin/settings");
  });

  it("shows every module to a user with every permission", () => {
    expect(visibleNav(PERMISSIONS)).toHaveLength(NAV_ITEMS.length);
  });

  it("shows nothing to a user with no permissions", () => {
    expect(visibleNav([])).toEqual([]);
  });
});
