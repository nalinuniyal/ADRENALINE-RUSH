// Concatenates supabase/migrations/*.sql into supabase/setup.sql: one file you
// paste into the Supabase SQL Editor. Every migration is written to be safe to
// re-run, so running setup.sql again after an update is fine.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const header = `-- =============================================================================
-- ADRENALINE RUSH: COMPLETE DATABASE SETUP
--
-- How to use:
--   1. Supabase dashboard -> SQL Editor -> New query
--   2. Paste this entire file and click "Run"
--   3. You should see "Success. No rows returned"
--
-- Safe to run again: after downloading a newer version of the app, run the
-- newer setup.sql the same way to apply the changes. Existing data is kept.
--
-- Generated from supabase/migrations by \`npm run db:setup-sql\`. Do not edit by hand.
-- Contains: ${files.join(", ")}
-- =============================================================================
`;

const body = files
  .map((f) => `\n-- >>>>>>>>>>>>>>>>>>>> ${f}\n\n${readFileSync(path.join(dir, f), "utf8").trim()}\n`)
  .join("\n");

writeFileSync(path.join(root, "supabase/setup.sql"), `${header}${body}`);
console.log(`Wrote supabase/setup.sql from ${files.length} migrations`);
