import type { Client } from "pg";
import { as, createAuthUser } from "./harness";

export type Org = { orgId: string; ownerId: string; staffId: string; instructorId: string; outsiderId: string };

/** Bootstraps an org with owner, staff and instructor (both roles enabled). Synthetic identities only. */
export async function seedOrg(db: Client): Promise<Org> {
  const ownerId = await createAuthUser(db, "owner@example.test", "Test Owner");
  const staffId = await createAuthUser(db, "staff@example.test", "Test Staff");
  const instructorId = await createAuthUser(db, "instructor@example.test", "Test Instructor");
  const outsiderId = await createAuthUser(db, "outsider@example.test");
  const orgId = await as(
    db,
    { role: "service_role" },
    async (c) => {
      const { rows } = await c.query<{ id: string }>("select public.bootstrap_organization($1, 'Test Academy', 'test-academy') as id", [ownerId]);
      const id = rows[0].id;
      await c.query("update public.organizations set staff_enabled = true, instructors_enabled = true where id = $1", [id]);
      await c.query(
        "insert into public.organization_memberships (organization_id, user_id, role) values ($1, $2, 'staff'), ($1, $3, 'instructor')",
        [id, staffId, instructorId],
      );
      return id;
    },
    true,
  );
  return { orgId, ownerId, staffId, instructorId, outsiderId };
}

export const user = (userId: string) => ({ role: "authenticated" as const, userId });
