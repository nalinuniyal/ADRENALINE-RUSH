import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

export const adminUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";

/** Creates a throwaway database, applies the Supabase stub and every migration in order. */
export async function createTestDatabase(): Promise<{ client: Client; drop: () => Promise<void> }> {
  const dbName = `ar_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  await client.query(readFileSync(path.join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  return {
    client,
    drop: async () => {
      await client.end();
      const a = new Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database if exists ${dbName} with (force)`);
      await a.end();
    },
  };
}

type Who = { role: "anon" } | { role: "authenticated"; userId: string } | { role: "service_role" };

/**
 * Runs fn inside a transaction impersonating a Supabase API role, exactly as
 * PostgREST does (SET LOCAL ROLE + request.jwt.claims), then rolls back
 * unless commit is true.
 */
export async function as<T>(client: Client, who: Who, fn: (c: Client) => Promise<T>, commit = false): Promise<T> {
  await client.query("begin");
  try {
    const claims =
      who.role === "authenticated" ? { sub: who.userId, role: "authenticated" } : { role: who.role };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await client.query(`set local role ${who.role}`);
    const result = await fn(client);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function createAuthUser(client: Client, email: string, fullName?: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(fullName ? { full_name: fullName } : {})],
  );
  return rows[0].id;
}
