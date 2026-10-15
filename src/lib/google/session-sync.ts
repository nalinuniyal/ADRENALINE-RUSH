import type { EventDetails } from "./calendar";

/** Pure decisions for keeping a class session and its Google Calendar event in step. */

export type SyncableSession = {
  id: string;
  title: string;
  description: string | null;
  prep_notes: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: "scheduled" | "completed" | "cancelled";
  meeting_source: string | null;
  google_event_id: string | null;
  google_add_attendees: boolean;
};

export type SyncPlan = "upsert" | "remove" | "none";

/**
 * - Google Meet chosen and the session not cancelled -> create or update the event.
 * - Otherwise, if an event exists (cancelled, or switched to a manual link) -> delete it.
 */
export function planGoogleSync(s: Pick<SyncableSession, "meeting_source" | "status" | "google_event_id">): SyncPlan {
  if (s.meeting_source === "google" && s.status !== "cancelled") return "upsert";
  if (s.google_event_id) return "remove";
  return "none";
}

export function eventDetailsFor(
  s: SyncableSession,
  context: { courseTitle: string | null; batchName: string | null; businessName: string },
  attendeeEmails: readonly string[],
): EventDetails {
  const prefix = [context.courseTitle, context.batchName].filter(Boolean).join(" · ");
  const description = [
    s.description,
    s.prep_notes ? `Before the session:\n${s.prep_notes}` : null,
    `Scheduled by ${context.businessName}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const emails = s.google_add_attendees
    ? [...new Set(attendeeEmails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 200)
    : [];
  return {
    summary: (prefix ? `${prefix}: ${s.title}` : s.title).slice(0, 250),
    description: description.slice(0, 7000),
    startsAt: new Date(s.starts_at).toISOString(),
    endsAt: new Date(s.ends_at).toISOString(),
    timeZone: s.timezone,
    attendees: emails,
  };
}
