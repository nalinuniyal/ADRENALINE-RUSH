/**
 * Report periods. A period is two inclusive calendar dates ("YYYY-MM-DD") in
 * the business time zone; the database converts timestamps with the same
 * zone (public.analytics_tz), so "this month" means the same thing on the
 * server, in SQL and on screen. Client-safe: no server imports.
 */

export const RANGE_PRESETS = ["this_month", "last_month", "last_90_days", "this_year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_90_days: "Last 90 days",
  this_year: "This year",
  custom: "Custom",
};

export type Bucket = "day" | "week" | "month";

export type DateRange = {
  preset: RangePreset;
  from: string;
  to: string;
  /** Number of calendar days in the period (inclusive). */
  days: number;
  bucket: Bucket;
  /** Set when a custom period was invalid and the default was used instead. */
  error?: string;
};

/** Longest period accepted (matches public.analytics_check). */
export const MAX_RANGE_DAYS = 3700;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date in a time zone, "YYYY-MM-DD". */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Day buckets up to ~6 weeks, weeks up to ~6 months, then months. */
export function bucketFor(days: number): Bucket {
  if (days <= 45) return "day";
  if (days <= 190) return "week";
  return "month";
}

export function presetRange(preset: Exclude<RangePreset, "custom">, timeZone: string, now = new Date()): { from: string; to: string } {
  const today = todayIn(timeZone, now);
  const year = today.slice(0, 4);
  switch (preset) {
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const to = shift(firstThis, -1);
      return { from: `${to.slice(0, 7)}-01`, to };
    }
    case "last_90_days":
      return { from: shift(today, -89), to: today };
    case "this_year":
      return { from: `${year}-01-01`, to: today };
  }
}

function build(preset: RangePreset, from: string, to: string, error?: string): DateRange {
  const days = daysBetween(from, to);
  return { preset, from, to, days, bucket: bucketFor(days), ...(error ? { error } : {}) };
}

/**
 * Reads ?range=&from=&to= into a period. Unknown presets fall back to this
 * month; an invalid custom period falls back too and carries an error message.
 */
export function resolveRange(params: Record<string, string | string[] | undefined>, timeZone: string, now = new Date()): DateRange {
  const get = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const raw = get("range");
  const from = get("from");
  const to = get("to");
  // A from/to pair without a preset means custom (e.g. a link from another page).
  const preset: RangePreset = RANGE_PRESETS.includes(raw as RangePreset) ? (raw as RangePreset) : from || to ? "custom" : "this_month";

  if (preset !== "custom") {
    const r = presetRange(preset, timeZone, now);
    return build(preset, r.from, r.to);
  }
  const fallback = presetRange("this_month", timeZone, now);
  if (!isIsoDate(from) || !isIsoDate(to)) return build("this_month", fallback.from, fallback.to, "Choose both a start and an end date.");
  if (from > to) return build("this_month", fallback.from, fallback.to, "The start date must be on or before the end date.");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return build("this_month", fallback.from, fallback.to, "Choose a period of ten years or less.");
  return build("custom", from, to);
}

/** Query string for links that keep the period ("?range=last_month" or "?range=custom&from=…&to=…"). */
export function rangeQuery(r: Pick<DateRange, "preset" | "from" | "to">, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  p.set("range", r.preset);
  if (r.preset === "custom") {
    p.set("from", r.from);
    p.set("to", r.to);
  }
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return `?${p.toString()}`;
}

const fmtDay = (d: string, withYear: boolean) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** "1 Oct – 15 Oct 2026" / "1 Dec 2025 – 31 Jan 2026" / "15 Oct 2026". */
export function formatRange(from: string, to: string): string {
  if (from === to) return fmtDay(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmtDay(from, !sameYear)} – ${fmtDay(to, true)}`;
}

/** Axis/table label for a bucket start date. */
export function formatBucket(date: string, bucket: Bucket): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (bucket === "month") return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
