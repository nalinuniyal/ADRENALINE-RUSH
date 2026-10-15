import { startGoogleConnect } from "@/app/actions/google";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/format";
import { getGoogleStatus } from "@/lib/google/integration";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { DisconnectGoogleButton } from "./google-disconnect";

const CALLBACK_MESSAGES: Record<string, { tone: "success" | "danger" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Google Calendar connected. Choose “Create Google Meet link” when you add a session." },
  denied: { tone: "warning", text: "Google access was not granted, so nothing changed." },
  scope_missing: { tone: "danger", text: "Calendar access was not ticked on Google’s screen. Connect again and allow calendar events." },
  no_refresh_token: { tone: "danger", text: "Google did not give a long-lived token. Remove this app at myaccount.google.com/permissions, then connect again." },
  state_mismatch: { tone: "danger", text: "That sign-in link was not started from this browser, so it was ignored for your safety. Click Connect again." },
  expired: { tone: "warning", text: "The Google sign-in took more than 10 minutes. Click Connect again." },
  not_configured: { tone: "danger", text: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set on this server. See the setup guide." },
  forbidden: { tone: "danger", text: "Only people who manage integrations can connect Google." },
  failed: { tone: "danger", text: "Google sign-in could not be completed. Check the redirect URI in Google Cloud, then try again." },
};

/** Settings › Integrations row for Google Calendar & Meet. */
export async function GoogleIntegrationRow({
  supabase,
  orgId,
  canManage,
  callback,
  memberName,
  timeZone,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  orgId: string;
  canManage: boolean;
  callback?: string;
  memberName: (id: string | null) => string;
  timeZone: string;
}) {
  const status = await getGoogleStatus(supabase, orgId);
  const msg = callback ? CALLBACK_MESSAGES[callback] : undefined;
  const connected = status.state === "connected";

  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Google Calendar &amp; Meet</span>
        <span className="flex flex-wrap items-center gap-2">
          {connected ? (
            <Badge tone="success">Connected</Badge>
          ) : status.state === "disconnected" || status.state === "error" ? (
            <Badge tone="warning">Needs reconnecting</Badge>
          ) : (
            <Badge>{status.configured ? "Not connected" : "Not set up"}</Badge>
          )}
          {canManage && status.configured ? (
            <form action={startGoogleConnect}>
              <SubmitButton size="sm" variant={connected ? "secondary" : "primary"} pendingLabel="Opening Google…">
                {connected ? "Reconnect" : status.state === "never" ? "Connect Google" : "Reconnect Google"}
              </SubmitButton>
            </form>
          ) : null}
          {canManage && (connected || status.state === "error") ? <DisconnectGoogleButton /> : null}
        </span>
      </div>
      {connected && status.connectedAt ? (
        <p className="text-xs text-muted">
          Connected by {memberName(status.connectedBy)} on {formatDateTime(status.connectedAt, timeZone)}. Meet links are created in that Google account’s calendar.
        </p>
      ) : null}
      {!connected && status.lastError ? <p className="text-xs text-warning-700">{status.lastError}</p> : null}
      {!status.configured ? (
        <p className="text-xs text-muted">
          Optional. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see “Connect Google Calendar &amp; Meet” in the setup guide) to create Meet links automatically.
          Until then, paste any meeting link into a session.
        </p>
      ) : null}
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
    </li>
  );
}
