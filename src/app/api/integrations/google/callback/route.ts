import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/auth/session";
import { hasAny } from "@/lib/auth/permissions";
import { exchangeCode, GoogleApiError, googleConfig } from "@/lib/google/calendar";
import { integrationKey } from "@/lib/google/crypto";
import { saveGoogleConnection } from "@/lib/google/integration";
import { checkState, STATE_COOKIE } from "@/lib/google/oauth-state";

/**
 * Google redirects here after the owner approves calendar access.
 * Accepted only when the `state` matches the signed cookie set by
 * "Connect Google" for this same signed-in user (CSRF / login-swap guard).
 */
export async function GET(request: NextRequest) {
  const back = (result: string) => {
    const res = NextResponse.redirect(new URL(`/admin/settings?google=${result}#integrations`, request.nextUrl.origin), { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(STATE_COOKIE, "", { path: "/api/integrations/google", maxAge: 0 });
    return res;
  };

  const access = await getAccess();
  if (access.status !== "ok") return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  if (!hasAny(access.access.permissions, ["integrations.manage"])) return back("forbidden");

  const params = request.nextUrl.searchParams;
  const check = checkState(
    request.cookies.get(STATE_COOKIE)?.value,
    params.get("state"),
    { userId: access.access.userId, orgId: access.access.organization.id },
    integrationKey(),
  );
  if (!check.ok) return back(check.reason === "expired" ? "expired" : "state_mismatch");
  // The person pressed "Cancel" on Google's screen.
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "denied" : "failed");

  const code = params.get("code");
  const cfg = googleConfig();
  if (!code) return back("failed");
  if (!cfg) return back("not_configured");

  try {
    const tokens = await exchangeCode(cfg, code, check.state.verifier);
    await saveGoogleConnection(access.access.organization.id, access.access.userId, tokens);
    return back("connected");
  } catch (e) {
    const reason = e instanceof GoogleApiError ? e.reason : null;
    console.error(JSON.stringify({ level: "error", msg: "google connect failed", status: e instanceof GoogleApiError ? e.status : null, reason }));
    return back(reason === "scope_missing" ? "scope_missing" : reason === "no_refresh_token" ? "no_refresh_token" : "failed");
  }
}
