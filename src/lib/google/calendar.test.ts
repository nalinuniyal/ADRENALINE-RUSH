import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAuthUrl,
  CalendarClient,
  conferenceStatus,
  eventIdForSession,
  exchangeCode,
  GOOGLE_SCOPE,
  GoogleApiError,
  GoogleAuthRevokedError,
  googleConfig,
  meetUrlOf,
  refreshAccessToken,
  revokeToken,
  type FetchLike,
} from "./calendar";

const cfg = { clientId: "client-id.apps.example", clientSecret: "test-secret", redirectUri: "https://app.example.test/api/integrations/google/callback" };
const SESSION = "0b8f6a52-0c55-4c7f-9a52-3d0b6c1e9a10";
const EVENT_ID = "0b8f6a520c554c7f9a523d0b6c1e9a10";
const details = { summary: "MCP · Class 1", description: "Bring a laptop", startsAt: "2026-10-17T05:30:00.000Z", endsAt: "2026-10-17T07:30:00.000Z", timeZone: "Asia/Kolkata", attendees: [] };
const meetEvent = {
  id: EVENT_ID,
  status: "confirmed",
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  conferenceData: { createRequest: { status: { statusCode: "success" } }, entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] },
};

type Call = { url: string; init: RequestInit };
function stub(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const form = (init: RequestInit) => new URLSearchParams(String(init.body));

describe("config and auth URL", () => {
  it("is null without credentials and derives the redirect URI from the site URL", () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", NEXT_PUBLIC_SITE_URL: "https://x.example.test/" })?.redirectUri).toBe(
      "https://x.example.test/api/integrations/google/callback",
    );
  });

  it("asks only for calendar.events with offline access, consent, state and PKCE", () => {
    const url = new URL(buildAuthUrl(cfg, { state: "st4te", codeChallenge: "ch4llenge" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: GOOGLE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: "st4te",
      code_challenge: "ch4llenge",
      code_challenge_method: "S256",
      redirect_uri: cfg.redirectUri,
      response_type: "code",
    });
  });
});

describe("token exchange and refresh", () => {
  it("exchanges a code with the PKCE verifier", async () => {
    const { fn, calls } = stub(json({ access_token: "at-1", expires_in: 3599, refresh_token: "rt-1", scope: `openid ${GOOGLE_SCOPE}` }));
    const t = await exchangeCode(cfg, "code-1", "verifier-1", fn, 1_000);
    expect(t).toEqual({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: 1_000 + 3_599_000, scope: `openid ${GOOGLE_SCOPE}` });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(form(calls[0].init))).toMatchObject({ grant_type: "authorization_code", code: "code-1", code_verifier: "verifier-1", client_secret: "test-secret" });
  });

  it("refuses a grant without calendar scope or without a refresh token", async () => {
    await expect(exchangeCode(cfg, "c", "v", stub(json({ access_token: "a", refresh_token: "r", scope: "openid" })).fn)).rejects.toMatchObject({ reason: "scope_missing" });
    await expect(exchangeCode(cfg, "c", "v", stub(json({ access_token: "a", scope: GOOGLE_SCOPE })).fn)).rejects.toMatchObject({ reason: "no_refresh_token" });
  });

  it("surfaces Google's OAuth error without leaking the code", async () => {
    const err = await exchangeCode(cfg, "secret-code", "v", stub(json({ error: "invalid_grant", error_description: "Bad Request" }, 400)).fn).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.message).not.toContain("secret-code");
  });

  it("refreshes, and reports revoked access distinctly", async () => {
    const ok = await refreshAccessToken(cfg, "rt-1", stub(json({ access_token: "at-2", expires_in: 3600, scope: GOOGLE_SCOPE })).fn, 0);
    expect(ok).toMatchObject({ accessToken: "at-2", refreshToken: null, expiresAt: 3_600_000 });
    await expect(refreshAccessToken(cfg, "rt-1", stub(json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)).fn)).rejects.toBeInstanceOf(
      GoogleAuthRevokedError,
    );
    const outage = await refreshAccessToken(cfg, "rt-1", stub(json({ error: "internal_failure" }, 503)).fn).catch((e) => e);
    expect(outage).not.toBeInstanceOf(GoogleAuthRevokedError);
    expect(outage.retryable).toBe(true);
  });

  it("treats network failures as retryable and revoke as best effort", async () => {
    const err = await refreshAccessToken(cfg, "rt", stub(new TypeError("fetch failed")).fn).catch((e) => e);
    expect(err).toMatchObject({ status: 0, retryable: true });
    expect(await revokeToken("rt", stub(new TypeError("fetch failed")).fn)).toBe(false);
    expect(await revokeToken("rt", stub(new Response("", { status: 400 })).fn)).toBe(true);
  });
});

describe("calendar events", () => {
  it("derives a valid, stable event id from the session id", () => {
    expect(eventIdForSession(SESSION)).toBe(EVENT_ID);
    expect(() => eventIdForSession("not-a-uuid")).toThrow();
  });

  it("creates an event with a Meet request and reads the link", async () => {
    const { fn, calls } = stub(json(meetEvent));
    const ev = await new CalendarClient("at-1", "primary", fn).upsertForSession(SESSION, null, { ...details, attendees: ["s@example.test"] }, true);
    expect(meetUrlOf(ev)).toBe("https://meet.google.com/abc-defg-hij");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer at-1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      id: EVENT_ID,
      start: { dateTime: details.startsAt, timeZone: "Asia/Kolkata" },
      attendees: [{ email: "s@example.test" }],
      conferenceData: { createRequest: { requestId: `ar-${SESSION}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
  });

  it("adopts the event from an interrupted earlier attempt instead of duplicating it", async () => {
    const { fn, calls } = stub(json({ error: { code: 409, message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } }, 409), json(meetEvent), json(meetEvent));
    const ev = await new CalendarClient("at", "primary", fn).upsertForSession(SESSION, null, details, false);
    expect(meetUrlOf(ev)).toBeTruthy();
    expect(calls.map((c) => c.init.method)).toEqual(["POST", "GET", "PATCH"]);
    // The existing event already has a Meet: no new conference request.
    expect(JSON.parse(String(calls[2].init.body)).conferenceData).toBeUndefined();
  });

  it("patches an existing event and restores a cancelled one with a Meet request", async () => {
    const { fn, calls } = stub(json({ id: EVENT_ID, status: "cancelled" }), json(meetEvent));
    await new CalendarClient("at", "primary", fn).upsertForSession(SESSION, EVENT_ID, details, false);
    expect(calls.map((c) => c.init.method)).toEqual(["GET", "PATCH"]);
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.status).toBe("confirmed");
    expect(body.conferenceData.createRequest.requestId).toBe(`ar-${SESSION}`);
  });

  it("re-creates an event that was removed from Google", async () => {
    const { fn, calls } = stub(new Response("", { status: 404 }), json(meetEvent));
    await new CalendarClient("at", "primary", fn).upsertForSession(SESSION, EVENT_ID, details, false);
    expect(calls.map((c) => c.init.method)).toEqual(["GET", "POST"]);
  });

  it("reports a pending Meet and missing links honestly", () => {
    expect(conferenceStatus({ id: "x", conferenceData: { createRequest: { status: { statusCode: "pending" } } } })).toBe("pending");
    expect(meetUrlOf({ id: "x" })).toBeNull();
    expect(meetUrlOf({ id: "x", hangoutLink: "javascript:alert(1)" })).toBeNull();
  });

  it("deletes events, treating already-gone as success", async () => {
    const { fn, calls } = stub(new Response(null, { status: 204 }), new Response("", { status: 410 }));
    const client = new CalendarClient("at", "team@example.test", fn);
    await client.remove(EVENT_ID, false);
    await client.remove(EVENT_ID, false);
    expect(calls[0].url).toContain("/calendars/team%40example.test/events/");
    expect(new URL(calls[0].url).searchParams.get("sendUpdates")).toBe("none");
  });

  it("raises API errors with status and reason", async () => {
    const { fn } = stub(json({ error: { code: 403, message: "Rate Limit Exceeded", errors: [{ reason: "rateLimitExceeded" }] } }, 403));
    const err = await new CalendarClient("at", "primary", fn).remove(EVENT_ID, false).catch((e) => e);
    expect(err).toMatchObject({ status: 403, reason: "rateLimitExceeded", retryable: true });
    const unauthorized = await new CalendarClient("at", "primary", stub(json({ error: { code: 401, message: "Invalid Credentials" } }, 401)).fn).get(EVENT_ID).catch((e) => e);
    expect(unauthorized).toMatchObject({ status: 401 });
  });
});
