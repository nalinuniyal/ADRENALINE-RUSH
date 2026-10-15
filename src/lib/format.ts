/** Display helpers. Storage is always UTC timestamptz / numeric; these only format. */

export function formatMoney(amount: number | string | null | undefined, currency = "INR"): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatDate(value: string | Date | null | undefined, timeZone = "Asia/Kolkata"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: typeof value === "string" && value.length === 10 ? "UTC" : timeZone,
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, timeZone = "Asia/Kolkata"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

export function formatTime(value: string | Date, timeZone = "Asia/Kolkata"): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone }).format(d);
}

const DELIVERY_LABELS: Record<string, string> = {
  online: "Online",
  in_person: "In-person",
  hybrid: "Hybrid",
  self_paced: "Self-paced",
  customized: "Customized",
};
export function deliveryLabel(mode: string | null | undefined): string {
  return mode ? (DELIVERY_LABELS[mode] ?? mode) : "—";
}
export const DELIVERY_MODES = Object.entries(DELIVERY_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Converts a wall-clock date + time in a time zone into a UTC ISO string,
 * e.g. ("2026-11-02", "19:30", "Asia/Kolkata") -> "2026-11-02T14:00:00.000Z".
 */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  let utc = guess - offset * 60_000;
  // Re-check once for DST transitions.
  const offset2 = tzOffsetMinutes(new Date(utc), timeZone);
  if (offset2 !== offset) utc = guess - offset2 * 60_000;
  return new Date(utc).toISOString();
}

/** Minutes the zone is ahead of UTC at the given instant. */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Splits a UTC instant into wall-clock date ("YYYY-MM-DD") and time ("HH:mm") in a zone. */
export function utcToZonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
