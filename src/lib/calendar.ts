import { addDays, weekdayOf } from "@/lib/batches/schedule";
import { utcToZonedParts, zonedToUtc } from "@/lib/format";

/** Calendar helpers. Dates are "YYYY-MM-DD" wall-clock dates in the business time zone. */

export type CalendarView = "month" | "week";

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isDateString(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function todayIn(timeZone: string, now = new Date()): string {
  return utcToZonedParts(now.toISOString(), timeZone).date;
}

/** Monday on or before the date. */
export function startOfWeek(date: string): string {
  const dow = weekdayOf(date);
  return addDays(date, -((dow + 6) % 7));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-01`;
}

/** Weeks (Monday first) covering the whole month of `date`. */
export function monthGrid(date: string): string[][] {
  const first = startOfMonth(date);
  const nextMonth = addMonths(first, 1);
  const weeks: string[][] = [];
  for (let day = startOfWeek(first); day < nextMonth; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

export function weekDays(date: string): string[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** UTC instants bounding [firstDate 00:00, lastDate+1 00:00) in the zone. */
export function utcRange(firstDate: string, lastDate: string, timeZone: string): { from: string; to: string } {
  return { from: zonedToUtc(firstDate, "00:00", timeZone), to: zonedToUtc(addDays(lastDate, 1), "00:00", timeZone) };
}

export function groupByLocalDate<T extends { starts_at: string }>(items: readonly T[], timeZone: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = utcToZonedParts(item.starts_at, timeZone).date;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

export function monthLabel(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function dayLabel(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
