import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { roleLabel, type MemberRole } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import { checkRateLimit, clientIp } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INVITE_LIMITS } from "@/lib/team/limits";
import { inviteProblemMessage, ROLE_DESCRIPTIONS } from "@/lib/team/rules";
import { hashInviteToken, isWellFormedInviteToken } from "@/lib/team/tokens";
import { AcceptInviteForm } from "./accept-form";

// Private link: never indexed, never sent as a referrer.
export const metadata: Metadata = { title: "Join the team", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <div className="w-full max-w-lg rounded-2xl border border-white/20 bg-surface/95 p-6 shadow-[0_30px_80px_-20px_rgb(0_22_57/0.8)] backdrop-blur-xl sm:p-8 animate-scale-in">
      <Suspense fallback={<p className="text-sm text-muted">Checking your invitation…</p>}>
        <InviteGate params={params} />
      </Suspense>
    </div>
  );
}

function Problem({ title, children }: { title: string; children: string }) {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <Alert tone="warning" className="mt-4">
        {children}
      </Alert>
      <Link href="/login" className={buttonVariants({ variant: "secondary", className: "mt-6" })}>
        Go to sign in
      </Link>
    </>
  );
}

async function InviteGate({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  if (!isWellFormedInviteToken(token)) return <Problem title="Invitation not found">{inviteProblemMessage("not_found") ?? ""}</Problem>;

  const rate = await checkRateLimit(INVITE_LIMITS.viewPerIp, await clientIp());
  if (rate === "limited") return <Problem title="Please wait a moment">Too many attempts from this network. Please try again in an hour.</Problem>;
  if (rate === "unavailable") return <Problem title="Something is not set up">The site cannot reach its database right now. Please try again later.</Problem>;

  const { data, error } = await createSupabaseAdminClient().rpc("get_team_invitation", { p_token_hash: hashInviteToken(token) });
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "invitation page lookup failed", code: error.code }));
    return <Problem title="Something went wrong">We could not check this invitation. Please try again in a few minutes.</Problem>;
  }
  const invite = data?.[0];
  const problem = inviteProblemMessage(invite?.status ?? "not_found");
  if (!invite || problem) {
    const title = invite?.status === "expired" ? "Invitation expired" : invite?.status === "accepted" ? "Invitation already used" : invite?.status === "revoked" ? "Invitation cancelled" : "Invitation not found";
    return <Problem title={title}>{problem ?? ""}</Problem>;
  }

  const role = invite.role as MemberRole;
  const { data: custom } = await createSupabaseAdminClient()
    .from("team_invitations")
    .select("custom_roles(name, description)")
    .eq("id", invite.invitation_id)
    .maybeSingle();
  const customRole = Array.isArray(custom?.custom_roles) ? custom.custom_roles[0] : custom?.custom_roles;
  return (
    <>
      <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">Team invitation</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Join {invite.organization_name}</h1>
      <p className="mt-2 text-sm text-muted">
        You are invited as <strong className="text-fg">{roleLabel(role, customRole?.name)}</strong>. {customRole ? (customRole.description ?? "") : ROLE_DESCRIPTIONS[role]}
      </p>
      {!invite.role_enabled ? (
        <Alert tone="info" className="mt-4">
          The owner has not switched on dashboard access for this role yet. You can set up your login now and sign in once it is switched on.
        </Alert>
      ) : null}
      <p className="mt-4 text-xs text-muted">This link works once and expires on {formatDate(invite.expires_at)}.</p>
      <AcceptInviteForm token={token} email={invite.email} initialName={invite.full_name} />
    </>
  );
}
