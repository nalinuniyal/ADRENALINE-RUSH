import { describe, expect, it } from "vitest";
import { eventDetailsFor, planGoogleSync, type SyncableSession } from "./session-sync";

const s: SyncableSession = {
  id: "0b8f6a52-0c55-4c7f-9a52-3d0b6c1e9a10",
  title: "Class 3",
  description: "Journeys deep dive",
  prep_notes: "Install the CLI",
  starts_at: "2026-10-17T05:30:00+00:00",
  ends_at: "2026-10-17T07:30:00+00:00",
  timezone: "Asia/Kolkata",
  status: "scheduled",
  meeting_source: "google",
  google_event_id: null,
  google_add_attendees: false,
};

describe("planGoogleSync", () => {
  it("upserts Google sessions, removes events no longer wanted, ignores manual ones", () => {
    expect(planGoogleSync(s)).toBe("upsert");
    expect(planGoogleSync({ ...s, status: "cancelled", google_event_id: "abcde" })).toBe("remove");
    expect(planGoogleSync({ ...s, meeting_source: "manual", google_event_id: "abcde" })).toBe("remove");
    expect(planGoogleSync({ ...s, meeting_source: "manual" })).toBe("none");
    expect(planGoogleSync({ ...s, status: "cancelled" })).toBe("none");
  });
});

describe("eventDetailsFor", () => {
  const ctx = { courseTitle: "MCP", batchName: "Oct Weekend", businessName: "Test Academy" };

  it("builds the summary and description without internal notes", () => {
    const d = eventDetailsFor(s, ctx, ["a@example.test"]);
    expect(d).toMatchObject({ summary: "MCP · Oct Weekend: Class 3", startsAt: "2026-10-17T05:30:00.000Z", timeZone: "Asia/Kolkata", attendees: [] });
    expect(d.description).toContain("Install the CLI");
  });

  it("adds deduplicated, valid attendee emails only when the toggle is on", () => {
    const d = eventDetailsFor({ ...s, google_add_attendees: true }, ctx, ["A@example.test", "a@example.test", "not-an-email", " b@example.test "]);
    expect(d.attendees).toEqual(["a@example.test", "b@example.test"]);
  });
});
