import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAny, type MemberRole, type Permission } from "@/lib/auth/permissions";

export type Access = {
  userId: string;
  email: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
  };
  membershipId: string;
  /** Base role: decides data scope (instructors see only their batches) and sign-in switches. */
  role: MemberRole;
  /** Set when the owner gave this member a custom role (Settings › Roles & access). */
  customRole: { id: string; name: string } | null;
  permissions: string[];
};

export type AccessResult =
  | { status: "signed_out" }
  | { status: "no_membership"; userId: string; email: string }
  | { status: "ok"; access: Access };

/**
 * Data Access Layer entry point. Reads and verifies the session (getClaims
 * validates the JWT signature) and loads the user's membership and effective
 * permissions from the database in one RPC. Memoised per request.
 */
export const getAccess = cache(async (): Promise<AccessResult> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (claimsError || !claims?.sub) return { status: "signed_out" };

  const userId = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : "";

  const { data, error } = await supabase.rpc("get_my_access_v2");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "get_my_access failed", code: error.code }));
    throw new Error("Could not load your access. Please try again.");
  }
  const row = data?.[0];
  if (!row) return { status: "no_membership", userId, email };

  return {
    status: "ok",
    access: {
      userId,
      email,
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        slug: row.organization_slug,
        timezone: row.timezone,
        currency: row.default_currency,
      },
      membershipId: row.membership_id,
      role: row.role,
      customRole: row.custom_role_id && row.custom_role_name ? { id: row.custom_role_id, name: row.custom_role_name } : null,
      permissions: row.permissions,
    },
  };
});

/**
 * Use at the top of every protected page, layout, Server Action and Route
 * Handler. Redirects signed-out users to /login and users without an active
 * membership to /no-access. When `anyOf` is given and none is held, returns
 * { denied: true } so the page can render an access-denied state.
 */
export async function requireAccess(
  anyOf: readonly Permission[] = [],
): Promise<{ access: Access; denied: boolean }> {
  const result = await getAccess();
  if (result.status === "signed_out") redirect("/login");
  if (result.status === "no_membership") redirect("/no-access");
  return { access: result.access, denied: !hasAny(result.access.permissions, anyOf) };
}

/** For Server Actions: throws instead of rendering, never trusts the client. */
export async function assertPermission(anyOf: readonly Permission[]): Promise<Access> {
  const { access, denied } = await requireAccess(anyOf);
  if (denied) throw new Error("You do not have permission to perform this action.");
  return access;
}
