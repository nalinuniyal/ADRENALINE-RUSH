import { zonedToUtc } from "@/lib/format";

/** 0 = Sunday … 6 = Saturday, like Date.getDay() and batches.class_days. */
export const WEEKDAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
] as const;

export const MAX_GENERATED_SESSIONS = 200;

export type ScheduleInput = {
  /** First possible class date, "YYYY-MM-DD" (wall clock in timeZone). */
  startDate: string;
  /** Last possible class date (inclusive). Either this or weeks is required. */
  endDate?: string | null;
  /** Number of weeks from startDate, used when endDate is empty. */
  weeks?: number | null;
  days: readonly number[];
  /** "HH:mm" wall clock in timeZone. */
  startTime: string;
  endTime: string;
  timeZone: string;
};

export type PlannedSession = { date: string; startsAt: string; endsAt: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Adds whole days to a "YYYY-MM-DD" string (calendar arithmetic, no time zone). */
export function addDays(date: string, days: number): string {
  return toDateString(parseDate(date) + days * 864e5);
}

/** Day of week (0 = Sunday) of a calendar date. */
export function weekdayOf(date: string): number {
  return new Date(parseDate(date)).getUTCDay();
}

/**
 * Expands a weekly pattern into concrete sessions. Dates are iterated as
 * calendar dates and each one is converted from the batch's time zone to UTC,
 * so a class at 11:00 in Asia/Kolkata is stored as 05:30 UTC, and a class at
 * 19:00 in a zone with daylight saving stays at 19:00 local on both sides of
 * the change.
 */
export function generateSchedule(input: ScheduleInput): PlannedSession[] {
  const { startDate, days, startTime, endTime, timeZone } = input;
  if (!DATE_RE.test(startDate)) throw new Error("Start date must be YYYY-MM-DD");
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new Error("Times must be HH:mm");
  if (endTime <= startTime) throw new Error("End time must be after start time");
  const daySet = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (daySet.size === 0) throw new Error("Choose at least one class day");

  let last: string;
  if (input.endDate) {
    if (!DATE_RE.test(input.endDate)) throw new Error("End date must be YYYY-MM-DD");
    last = input.endDate;
  } else if (input.weeks && input.weeks > 0) {
    last = addDays(startDate, Math.floor(input.weeks) * 7 - 1);
  } else {
    throw new Error("Give an end date or a number of weeks");
  }
  if (last < startDate) throw new Error("End date must be on or after the start date");

  const out: PlannedSession[] = [];
  for (let date = startDate; date <= last && out.length < MAX_GENERATED_SESSIONS; date = addDays(date, 1)) {
    if (!daySet.has(weekdayOf(date))) continue;
    out.push({ date, startsAt: zonedToUtc(date, startTime, timeZone), endsAt: zonedToUtc(date, endTime, timeZone) });
  }
  return out;
}

/** "Sat, Sun · 11:00–13:00" */
export function scheduleSummary(days: readonly number[] | null | undefined, start?: string | null, end?: string | null): string {
  const names = WEEKDAYS.filter((d) => days?.includes(d.value)).map((d) => d.short);
  const time = start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : "";
  return [names.join(", "), time].filter(Boolean).join(" · ");
}
