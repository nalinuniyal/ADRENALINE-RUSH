"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/session";
import { buildAuthUrl, googleConfig } from "@/lib/google/calendar";
import { integrationKey } from "@/lib/google/crypto";
import { disconnectGoogle } from "@/lib/google/integration";
import { codeChallenge, newOAuthState, sealState, STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/google/oauth-state";

/** Starts "Connect Google": a POST (Server Action) so another site cannot start it for you. */
export async function startGoogleConnect(): Promise<void> {
  const access = await assertPermission(["integrations.manage"]);
  const cfg = googleConfig();
  if (!cfg) redirect("/admin/settings?google=not_configured#integrations");

  const state = newOAuthState(access.userId, access.organization.id);
  const jar = await cookies();
  jar.set(STATE_COOKIE, sealState(state, integrationKey()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/google",
    maxAge: STATE_TTL_SECONDS,
  });
  redirect(buildAuthUrl(cfg, { state: state.state, codeChallenge: codeChallenge(state.verifier) }));
}

export async function disconnectGoogleAction(): Promise<{ ok: boolean; message: string }> {
  const access = await assertPermission(["integrations.manage"]);
  try {
    const { revoked } = await disconnectGoogle(access.organization.id, access.userId);
    revalidatePath("/admin/settings");
    revalidatePath("/admin/calendar", "layout");
    return {
      ok: true,
      message: revoked
        ? "Google disconnected. Existing Meet links keep working; new sessions need a pasted link."
        : "Google disconnected here. Google could not be reached to revoke access, so also remove the app at myaccount.google.com/permissions.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not disconnect Google." };
  }
}
