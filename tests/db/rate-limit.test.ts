import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { as, createTestDatabase } from "./harness";

let db: Client;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
});
afterAll(async () => drop?.());

describe("consume_rate_limit", () => {
  it("allows up to the limit within a window, then blocks", async () => {
    const results = await as(db, { role: "service_role" }, async (c) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) {
        const { rows } = await c.query("select public.consume_rate_limit('test:key', 3, 600) as ok");
        out.push(rows[0].ok);
      }
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it("keeps separate counters per key", async () => {
    const { rows } = await as(db, { role: "service_role" }, (c) =>
      c.query("select public.consume_rate_limit('a', 1, 600) as a1, public.consume_rate_limit('b', 1, 600) as b1"),
    );
    expect(rows[0]).toEqual({ a1: true, b1: true });
  });

  it("is not callable by anon or signed-in users", async () => {
    for (const who of [{ role: "anon" as const }, { role: "authenticated" as const, userId: crypto.randomUUID() }]) {
      await expect(as(db, who, (c) => c.query("select public.consume_rate_limit('x', 1, 60)"))).rejects.toThrow(
        /permission denied/,
      );
      await expect(as(db, who, (c) => c.query("select * from public.rate_limit_buckets"))).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});
