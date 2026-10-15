import "server-only";
import type { Database } from "@/lib/database.types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CalendarClient,
  conferenceStatus,
  GoogleApiError,
  GoogleAuthRevokedError,
  googleConfig,
  meetUrlOf,
  refreshAccessToken,
  revokeToken,
  type FetchLike,
  type GoogleEvent,
  type TokenSet,
} from "./calendar";
import { decryptSecret, encryptSecret, integrationKey } from "./crypto";
import { eventDetailsFor, planGoogleSync, type SyncableSession } from "./session-sync";

/**
 * Server-side glue between the database and Google. Tokens are read and
 * written ONLY here, with the secret-key client (the token columns are not
 * granted to signed-in users), after the caller has been authorised.
 */

type UserClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type GoogleStatus = {
  /** GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. */
  configured: boolean;
  state: "connected" | "disconnected" | "error" | "never";
  connectedAt: string | null;
  connectedBy: string | null;
  lastError: string | null;
};

const log = (msg: string, extra: Record<string, unknown> = {}) => console.error(JSON.stringify({ level: "error", msg, ...extra }));

/** Status for display, read with the signed-in user's own client (RLS applies). */
export async function getGoogleStatus(supabase: UserClient, orgId: string): Promise<GoogleStatus> {
  const configured = googleConfig() !== null;
  const { data } = await supabase
    .from("google_integrations")
    .select("status, connected_at, connected_by, last_error")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return { configured, state: "never", connectedAt: null, connectedBy: null, lastError: null };
  const state = data.status === "connected" || data.status === "error" ? data.status : "disconnected";
  return { configured, state, connectedAt: data.connected_at, connectedBy: data.connected_by, lastError: data.last_error };
}

function audit(orgId: string, actorId: string | null, action: string, details: Record<string, unknown> = {}) {
  return createSupabaseAdminClient()
    .from("audit_logs")
    .insert({ organization_id: orgId, actor_id: actorId, action, entity_type: "integration", details: { provider: "google", ...details } })
    .then(({ error }) => {
      if (error) log("integration audit failed", { code: error.code });
    });
}

export async function saveGoogleConnection(orgId: string, userId: string, tokens: TokenSet): Promise<void> {
  const key = integrationKey();
  const { error } = await createSupabaseAdminClient()
    .from("google_integrations")
    .upsert(
      {
        organization_id: orgId,
        status: "connected",
        refresh_token_encrypted: tokens.refreshToken ? encryptSecret(tokens.refreshToken, key, orgId) : null,
        access_token_encrypted: encryptSecret(tokens.accessToken, key, orgId),
        access_token_expires_at: new Date(tokens.expiresAt).toISOString(),
        scopes: tokens.scope.slice(0, 1000),
        connected_by: userId,
        connected_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
      },
      { onConflict: "organization_id" },
    );
  if (error) {
    log("google connection save failed", { code: error.code });
    throw new Error("Could not save the Google connection. Check that supabase/setup.sql has been run.");
  }
  await audit(orgId, userId, "integration.connected");
}

/** Forgets the tokens (and asks Google to revoke them, best effort). */
export async function disconnectGoogle(orgId: string, userId: string, fetchImpl: FetchLike = fetch): Promise<{ revoked: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("google_integrations").select("refresh_token_encrypted").eq("organization_id", orgId).maybeSingle();
  let revoked = false;
  if (data?.refresh_token_encrypted) {
    try {
      revoked = await revokeToken(decryptSecret(data.refresh_token_encrypted, integrationKey(), orgId), fetchImpl);
    } catch {
      revoked = false;
    }
  }
  const { error } = await admin
    .from("google_integrations")
    .update({ status: "disconnected", refresh_token_encrypted: null, access_token_encrypted: null, access_token_expires_at: null, last_error: null, last_error_at: null })
    .eq("organization_id", orgId);
  if (error) {
    log("google disconnect failed", { code: error.code });
    throw new Error("Could not disconnect Google. Please try again.");
  }
  await audit(orgId, userId, "integration.disconnected", { revoked });
  return { revoked };
}

async function markBroken(orgId: string, status: "disconnected" | "error", message: string) {
  await createSupabaseAdminClient()
    .from("google_integrations")
    .update({
      status,
      last_error: message.slice(0, 500),
      last_error_at: new Date().toISOString(),
      ...(status === "disconnected" ? { refresh_token_encrypted: null, access_token_encrypted: null, access_token_expires_at: null } : {}),
    })
    .eq("organization_id", orgId);
}

export class GoogleNotConnectedError extends Error {
  constructor(message = "Google Calendar is not connected. Connect it in Settings › Integrations, or paste a meeting link instead.") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

/** Returns a Calendar client with a valid access token, refreshing it when needed. */
async function calendarFor(orgId: string, fetchImpl: FetchLike, forceRefresh = false): Promise<CalendarClient> {
  const cfg = googleConfig();
  if (!cfg) throw new GoogleNotConnectedError("Google is not set up on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing).");
  const admin = createSupabaseAdminClient();
  const { data: row, error } = await admin
    .from("google_integrations")
    .select("status, calendar_id, refresh_token_encrypted, access_token_encrypted, access_token_expires_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error("Could not read the Google connection.");
  if (!row || row.status === "disconnected" || !row.refresh_token_encrypted) throw new GoogleNotConnectedError();

  const key = integrationKey();
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(row.refresh_token_encrypted, key, orgId);
  } catch {
    const msg = "The saved Google connection can no longer be read (the encryption key changed). Reconnect Google.";
    await markBroken(orgId, "disconnected", msg);
    throw new GoogleNotConnectedError(msg);
  }

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (!forceRefresh && row.access_token_encrypted && expiresAt - Date.now() > 60_000) {
    try {
      return new CalendarClient(decryptSecret(row.access_token_encrypted, key, orgId), row.calendar_id, fetchImpl);
    } catch {
      // Fall through to a refresh.
    }
  }

  try {
    const tokens = await refreshAccessToken(cfg, refreshToken, fetchImpl);
    await admin
      .from("google_integrations")
      .update({
        status: "connected",
        access_token_encrypted: encryptSecret(tokens.accessToken, key, orgId),
        access_token_expires_at: new Date(tokens.expiresAt).toISOString(),
        // Google may rotate the refresh token.
        ...(tokens.refreshToken ? { refresh_token_encrypted: encryptSecret(tokens.refreshToken, key, orgId) } : {}),
        last_error: null,
        last_error_at: null,
      })
      .eq("organization_id", orgId);
    return new CalendarClient(tokens.accessToken, row.calendar_id, fetchImpl);
  } catch (e) {
    if (e instanceof GoogleAuthRevokedError) {
      await markBroken(orgId, "disconnected", e.message);
      await audit(orgId, null, "integration.revoked");
    } else if (e instanceof GoogleApiError) {
      await markBroken(orgId, "error", e.message);
    }
    throw e;
  }
}

/** Runs fn with a Calendar client; on 401 refreshes the token once and retries. */
async function withCalendar<T>(orgId: string, fetchImpl: FetchLike, fn: (c: CalendarClient) => Promise<T>): Promise<T> {
  const client = await calendarFor(orgId, fetchImpl);
  try {
    return await fn(client);
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 401) return fn(await calendarFor(orgId, fetchImpl, true));
    throw e;
  }
}

export type SyncResult = { ok: boolean; message: string; meetUrl?: string | null };

function friendly(e: unknown): string {
  if (e instanceof GoogleNotConnectedError || e instanceof GoogleAuthRevokedError) return e.message;
  if (e instanceof GoogleApiError) {
    if (e.retryable) return `${e.message}. Use Retry in a minute.`.replace("..", ".");
    if (e.status === 403) return `Google refused the request: ${e.message}`;
    return e.message;
  }
  return "Something went wrong while talking to Google. Use Retry.";
}

type SessionRow = SyncableSession & { organization_id: string; kind: string; batch_id: string | null; course_id: string; meeting_url: string | null };

async function attendeeEmails(session: SessionRow): Promise<string[]> {
  if (!session.google_add_attendees) return [];
  const admin = createSupabaseAdminClient();
  if (session.kind === "class" && session.batch_id) {
    const { data } = await admin
      .from("enrollments")
      .select("status, candidates(email)")
      .eq("batch_id", session.batch_id)
      .in("status", ["pending", "active", "on_hold"]);
    return (data ?? []).flatMap((r) => {
      const c = Array.isArray(r.candidates) ? r.candidates[0] : r.candidates;
      return c?.email ? [c.email] : [];
    });
  }
  const { data } = await admin.from("session_attendees").select("candidates(email)").eq("session_id", session.id);
  return (data ?? []).flatMap((r) => {
    const c = Array.isArray(r.candidates) ? r.candidates[0] : r.candidates;
    return c?.email ? [c.email] : [];
  });
}

/**
 * Brings Google in line with the session as stored. The session itself is
 * already saved; this only adds/updates/removes the event and records the
 * outcome on the session (synced, or failed with a reason for the Retry button).
 */
export async function syncSessionWithGoogle(
  orgId: string,
  sessionId: string,
  opts: { fetchImpl?: FetchLike; waitMs?: number } = {},
): Promise<SyncResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const admin = createSupabaseAdminClient();
  const { data: s, error } = await admin
    .from("class_sessions")
    .select(
      "id, organization_id, kind, batch_id, course_id, title, description, prep_notes, starts_at, ends_at, timezone, status, meeting_url, meeting_source, google_event_id, google_add_attendees, courses(title), batches(name), organizations(name)",
    )
    .eq("id", sessionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !s) return { ok: false, message: "That session could not be found." };
  const session = s as unknown as SessionRow & { courses: { title: string } | null; batches: { name: string } | null; organizations: { name: string } | null };

  const plan = planGoogleSync(session);
  if (plan === "none") return { ok: true, message: "" };

  const record = (patch: Database["public"]["Tables"]["class_sessions"]["Update"]) => admin.from("class_sessions").update(patch).eq("id", sessionId).eq("organization_id", orgId);

  if (plan === "remove") {
    try {
      await withCalendar(orgId, fetchImpl, (c) => c.remove(session.google_event_id as string, session.google_add_attendees));
      await record({
        google_event_id: null,
        google_sync_status: "none",
        google_sync_error: null,
        google_synced_at: new Date().toISOString(),
        // A cancelled Google session's Meet link no longer works.
        ...(session.meeting_source === "google" ? { meeting_url: null, meeting_source: null } : {}),
      });
      return { ok: true, message: "The Google Calendar event was removed." };
    } catch (e) {
      const message = `The Google Calendar event could not be removed: ${friendly(e)}`;
      await record({ google_sync_status: "failed", google_sync_error: message.slice(0, 500) });
      return { ok: false, message };
    }
  }

  let event: GoogleEvent | null = null;
  try {
    const details = eventDetailsFor(
      session,
      { courseTitle: session.courses?.title ?? null, batchName: session.batches?.name ?? null, businessName: session.organizations?.name ?? "your academy" },
      await attendeeEmails(session),
    );
    event = await withCalendar(orgId, fetchImpl, (c) => c.upsertForSession(session.id, session.google_event_id, details, details.attendees.length > 0));
    let meetUrl = meetUrlOf(event);
    if (!meetUrl && conferenceStatus(event) === "pending") {
      await new Promise((r) => setTimeout(r, opts.waitMs ?? 1500));
      const again = await withCalendar(orgId, fetchImpl, (c) => c.get(event!.id));
      if (again) {
        event = again;
        meetUrl = meetUrlOf(again);
      }
    }
    if (!meetUrl) {
      const message =
        conferenceStatus(event) === "failure"
          ? "Google created the calendar event but could not add a Meet link (Meet may be turned off for this Google account). Paste a link manually instead."
          : "Google created the calendar event but has not returned a Meet link yet. Use Retry in a minute.";
      await record({ google_event_id: event.id, google_sync_status: "failed", google_sync_error: message, google_synced_at: new Date().toISOString() });
      return { ok: false, message };
    }
    await record({
      google_event_id: event.id,
      meeting_url: meetUrl,
      meeting_source: "google",
      google_sync_status: "synced",
      google_sync_error: null,
      google_synced_at: new Date().toISOString(),
    });
    return { ok: true, message: "Google Meet link ready.", meetUrl };
  } catch (e) {
    const message = friendly(e);
    if (!(e instanceof GoogleNotConnectedError)) log("google session sync failed", { status: e instanceof GoogleApiError ? e.status : null, reason: e instanceof GoogleApiError ? e.reason : null });
    await record({ ...(event ? { google_event_id: event.id } : {}), google_sync_status: "failed", google_sync_error: message.slice(0, 500) });
    return { ok: false, message };
  }
}

/** Before deleting a session: remove its event. Returns an error message when Google refused. */
export async function removeGoogleEvent(orgId: string, eventId: string, notify: boolean, fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    await withCalendar(orgId, fetchImpl, (c) => c.remove(eventId, notify));
    return null;
  } catch (e) {
    return friendly(e);
  }
}
