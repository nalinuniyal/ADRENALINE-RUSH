import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminUrl } from "./harness";

describe("supabase/setup.sql", () => {
  it("applies cleanly to an empty database and can be run a second time", async () => {
    const dbName = `ar_setup_${Date.now()}`;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await c.query(readFileSync(path.join(__dirname, "supabase-stub.sql"), "utf8"));
      const sql = readFileSync(path.resolve(__dirname, "../../supabase/setup.sql"), "utf8");
      await c.query(sql);
      await c.query(sql);
      const { rows } = await c.query("select count(*)::int as n from public.permissions");
      expect(rows[0].n).toBeGreaterThan(10);
    } finally {
      await c.end();
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  it("is up to date with supabase/migrations", async () => {
    const { execFileSync } = await import("node:child_process");
    const before = readFileSync(path.resolve(__dirname, "../../supabase/setup.sql"), "utf8");
    execFileSync("node", [path.resolve(__dirname, "../../scripts/build-setup-sql.mjs")]);
    const after = readFileSync(path.resolve(__dirname, "../../supabase/setup.sql"), "utf8");
    expect(after).toBe(before);
  });
});
