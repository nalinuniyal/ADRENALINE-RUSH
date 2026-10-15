import "server-only";

/**
 * Minimal Google OAuth 2.0 + Calendar API v3 client. Every function takes an
 * injectable `fetch`, so the whole flow is unit-tested with stubbed responses.
 * Docs: https://developers.google.com/identity/protocols/oauth2/web-server
 *       https://developers.google.com/workspace/calendar/api/guides/create-events#conferencing
 */

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const REQUEST_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET; null when Google is not set up. */
export function googleConfig(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const site = (env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return { clientId, clientSecret, redirectUri: `${site}/api/integrations/google/callback` };
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
  /** Worth trying again later (rate limits, Google outages, timeouts). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500 || this.reason === "rateLimitExceeded" || this.reason === "userRateLimitExceeded";
  }
}

/** The refresh token no longer works (access removed in the Google account, or expired). */
export class GoogleAuthRevokedError extends GoogleApiError {
  constructor(message = "Google access was removed or has expired. Reconnect Google in Settings › Integrations.") {
    super(message, 400, "invalid_grant");
    this.name = "GoogleAuthRevokedError";
  }
}

async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new GoogleApiError(timedOut ? "Google did not answer in time. Try again." : "Could not reach Google. Check the internet connection and try again.", 0, "network");
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await res.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Builds a readable error from Google's JSON error formats (OAuth and Calendar). Never includes tokens. */
async function apiError(res: Response, fallback: string): Promise<GoogleApiError> {
  const body = await readJson(res);
  const err = body.error;
  if (typeof err === "string") {
    const desc = typeof body.error_description === "string" ? body.error_description : err;
    return new GoogleApiError(`${fallback}: ${desc}`.slice(0, 300), res.status, err);
  }
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; errors?: { reason?: unknown }[]; status?: unknown };
    const reason = typeof e.errors?.[0]?.reason === "string" ? e.errors[0].reason : typeof e.status === "string" ? e.status : null;
    const msg = typeof e.message === "string" ? e.message : res.statusText;
    return new GoogleApiError(`${fallback}: ${msg}`.slice(0, 300), res.status, reason);
  }
  return new GoogleApiError(`${fallback} (HTTP ${res.status})`, res.status);
}

/* -------------------------------------------------------------------------- */
/* OAuth                                                                       */
/* -------------------------------------------------------------------------- */

export function buildAuthUrl(cfg: GoogleConfig, opts: { state: string; codeChallenge: string }): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    // Always show consent so Google returns a refresh token on reconnect.
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

export type TokenSet = { accessToken: string; expiresAt: number; refreshToken: string | null; scope: string };

function parseTokens(body: Record<string, unknown>, now: number): TokenSet {
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new GoogleApiError("Google did not return an access token", 502);
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    accessToken,
    expiresAt: now + expiresIn * 1000,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

export async function exchangeCode(cfg: GoogleConfig, code: string, codeVerifier: string, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<TokenSet> {
  const res = await call(fetchImpl, TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw await apiError(res, "Google sign-in could not be completed");
  const tokens = parseTokens(await readJson(res), now);
  // With granular consent the person can untick calendar access.
  if (!tokens.scope.split(" ").includes(GOOGLE_SCOPE)) {
    throw new GoogleApiError("Calendar access was not granted. Connect again and tick the calendar permission.", 403, "scope_missing");
  }
  if (!tokens.refreshToken) {
    throw new GoogleApiError(
      "Google did not return a long-lived token. Remove the app at myaccount.google.com/permissions, then connect again.",
      400,
      "no_refresh_token",
    );
  }
  return tokens;
}

export async function refreshAccessToken(cfg: GoogleConfig, refreshToken: string, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<TokenSet> {
  const res = await call(fetchImpl, TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  });
  if (!res.ok) {
    const err = await apiError(res, "Could not refresh Google access");
    if (err.reason === "invalid_grant" || err.reason === "unauthorized_client") throw new GoogleAuthRevokedError();
    throw err;
  }
  return parseTokens(await readJson(res), now);
}

/** Best effort: Google forgets the grant. Returns false when Google could not be reached. */
export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const res = await call(fetchImpl, REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    // 400 means the token was already invalid: nothing left to revoke.
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Calendar events                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic event id (Google allows a-v and 0-9, 5–1024 chars). A UUID
 * without dashes qualifies, so retrying a create for the same session can
 * never make a second event: Google answers 409 instead.
 */
export function eventIdForSession(sessionId: string): string {
  const id = sessionId.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("Session id must be a UUID");
  return id;
}

export type EventDetails = {
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  attendees: string[];
};

export type GoogleEvent = {
  id: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { requestId?: string; status?: { statusCode?: string } };
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

export function meetUrlOf(event: GoogleEvent): string | null {
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  const url = video ?? event.hangoutLink ?? null;
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** "pending" means Google is still creating the Meet; "failure" means it will not. */
export function conferenceStatus(event: GoogleEvent): "success" | "pending" | "failure" | null {
  const code = event.conferenceData?.createRequest?.status?.statusCode;
  return code === "success" || code === "pending" || code === "failure" ? code : null;
}

function eventBody(d: EventDetails, meetRequestId: string | null): Record<string, unknown> {
  return {
    summary: d.summary,
    description: d.description,
    start: { dateTime: d.startsAt, timeZone: d.timeZone },
    end: { dateTime: d.endsAt, timeZone: d.timeZone },
    attendees: d.attendees.map((email) => ({ email })),
    guestsCanSeeOtherGuests: false,
    ...(meetRequestId ? { conferenceData: { createRequest: { requestId: meetRequestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
}

export class CalendarClient {
  constructor(
    private readonly accessToken: string,
    private readonly calendarId = "primary",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private url(path: string, params: Record<string, string> = {}): string {
    const qs = new URLSearchParams(params).toString();
    return `${CALENDAR_API}/calendars/${encodeURIComponent(this.calendarId)}/events${path}${qs ? `?${qs}` : ""}`;
  }

  private headers(json = true): HeadersInit {
    return { authorization: `Bearer ${this.accessToken}`, ...(json ? { "content-type": "application/json" } : {}) };
  }

  /** Inserts with our own event id; Google answers 409 if it already exists. */
  async insert(eventId: string, d: EventDetails, meetRequestId: string | null, notify: boolean): Promise<GoogleEvent> {
    const res = await call(this.fetchImpl, this.url("", { conferenceDataVersion: "1", sendUpdates: notify ? "all" : "none" }), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ id: eventId, ...eventBody(d, meetRequestId) }),
    });
    if (!res.ok) throw await apiError(res, "Google could not create the calendar event");
    return (await res.json()) as GoogleEvent;
  }

  async get(eventId: string): Promise<GoogleEvent | null> {
    const res = await call(this.fetchImpl, this.url(`/${encodeURIComponent(eventId)}`), { method: "GET", headers: this.headers(false) });
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw await apiError(res, "Google could not load the calendar event");
    return (await res.json()) as GoogleEvent;
  }

  /** Updates details; also restores a cancelled (deleted) event, and asks for a Meet when meetRequestId is given. */
  async patch(eventId: string, d: EventDetails, meetRequestId: string | null, notify: boolean): Promise<GoogleEvent> {
    const res = await call(this.fetchImpl, this.url(`/${encodeURIComponent(eventId)}`, { conferenceDataVersion: "1", sendUpdates: notify ? "all" : "none" }), {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ ...eventBody(d, meetRequestId), status: "confirmed" }),
    });
    if (!res.ok) throw await apiError(res, "Google could not update the calendar event");
    return (await res.json()) as GoogleEvent;
  }

  /** Deleting something already gone counts as success. */
  async remove(eventId: string, notify: boolean): Promise<void> {
    const res = await call(this.fetchImpl, this.url(`/${encodeURIComponent(eventId)}`, { sendUpdates: notify ? "all" : "none" }), {
      method: "DELETE",
      headers: this.headers(false),
    });
    if (res.ok || res.status === 404 || res.status === 410) return;
    throw await apiError(res, "Google could not delete the calendar event");
  }

  /**
   * Creates the event for a session, or adopts the one an earlier, interrupted
   * attempt already created (same deterministic id). Never makes duplicates.
   */
  async upsertForSession(sessionId: string, existingEventId: string | null, d: EventDetails, notify: boolean): Promise<GoogleEvent> {
    const eventId = existingEventId ?? eventIdForSession(sessionId);
    // Same request id for the same session: Google treats repeats as one Meet request.
    const requestId = `ar-${sessionId}`;
    if (!existingEventId) {
      try {
        return await this.insert(eventId, d, requestId, notify);
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
      }
    }
    const current = await this.get(eventId);
    if (!current) {
      // Removed from Google (or never created): create it again. Google keeps
      // ids of deleted events, so a 409 here means "restore it" instead.
      try {
        return await this.insert(eventId, d, requestId, notify);
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.status !== 409) throw error;
        return this.patch(eventId, d, requestId, notify);
      }
    }
    const needsMeet = current.status === "cancelled" || !meetUrlOf(current);
    return this.patch(eventId, d, needsMeet ? requestId : null, notify);
  }
}
