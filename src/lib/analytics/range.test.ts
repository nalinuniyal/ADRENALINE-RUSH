import { describe, expect, it } from "vitest";
import { bucketFor, daysBetween, formatRange, presetRange, rangeQuery, resolveRange, todayIn } from "./range";

const TZ = "Asia/Kolkata";
// 15 Oct 2026, 20:00 UTC = 16 Oct 2026, 01:30 in India.
const lateNight = new Date("2026-10-15T20:00:00Z");
const midday = new Date("2026-10-15T06:30:00Z");

describe("todayIn", () => {
  it("uses the business time zone, not UTC", () => {
    expect(todayIn(TZ, lateNight)).toBe("2026-10-16");
    expect(todayIn("UTC", lateNight)).toBe("2026-10-15");
  });
});

describe("presets in Asia/Kolkata", () => {
  it("this month runs from the 1st to today", () => {
    expect(presetRange("this_month", TZ, midday)).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(presetRange("this_month", TZ, lateNight)).toEqual({ from: "2026-10-01", to: "2026-10-16" });
  });

  it("this month flips at Indian midnight on the 1st", () => {
    // 31 Oct 2026 19:00 UTC = 1 Nov 00:30 IST
    expect(presetRange("this_month", TZ, new Date("2026-10-31T19:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });

  it("last month is the whole previous calendar month (leap years too)", () => {
    expect(presetRange("last_month", TZ, midday)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last_month", TZ, new Date("2028-03-10T06:00:00Z"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(presetRange("last_month", TZ, new Date("2027-01-05T06:00:00Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("last 90 days includes today", () => {
    const r = presetRange("last_90_days", TZ, midday);
    expect(r).toEqual({ from: "2026-07-18", to: "2026-10-15" });
    expect(daysBetween(r.from, r.to)).toBe(90);
  });

  it("this year starts on 1 January", () => {
    expect(presetRange("this_year", TZ, midday)).toEqual({ from: "2026-01-01", to: "2026-10-15" });
    expect(presetRange("this_year", TZ, new Date("2026-12-31T19:00:00Z"))).toEqual({ from: "2027-01-01", to: "2027-01-01" });
  });
});

describe("resolveRange", () => {
  it("defaults to this month", () => {
    expect(resolveRange({}, TZ, midday)).toMatchObject({ preset: "this_month", from: "2026-10-01", to: "2026-10-15", days: 15, bucket: "day" });
    expect(resolveRange({ range: "bogus" }, TZ, midday).preset).toBe("this_month");
  });

  it("accepts a valid custom period", () => {
    expect(resolveRange({ range: "custom", from: "2026-01-01", to: "2026-06-30" }, TZ, midday)).toMatchObject({ preset: "custom", days: 181, bucket: "week" });
    // from/to without a preset is a custom period too
    expect(resolveRange({ from: "2025-01-01", to: "2025-12-31" }, TZ, midday)).toMatchObject({ preset: "custom", bucket: "month" });
  });

  it("falls back with a message for invalid custom periods", () => {
    expect(resolveRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, TZ, midday)).toMatchObject({ preset: "this_month", error: expect.stringMatching(/start and an end/) });
    expect(resolveRange({ range: "custom", from: "2026-05-01", to: "2026-04-01" }, TZ, midday)).toMatchObject({ preset: "this_month", error: expect.stringMatching(/on or before/) });
    expect(resolveRange({ range: "custom", from: "2000-01-01", to: "2026-01-01" }, TZ, midday).error).toMatch(/ten years/);
    expect(resolveRange({ range: "custom", from: ["2026-01-01"], to: "x" }, TZ, midday).error).toBeTruthy();
  });

  it("builds links that keep the period", () => {
    expect(rangeQuery({ preset: "last_month", from: "2026-09-01", to: "2026-09-30" })).toBe("?range=last_month");
    expect(rangeQuery({ preset: "custom", from: "2026-01-01", to: "2026-02-01" }, { tab: "x" })).toBe("?range=custom&from=2026-01-01&to=2026-02-01&tab=x");
  });
});

describe("helpers", () => {
  it("chooses buckets by length", () => {
    expect([bucketFor(1), bucketFor(45), bucketFor(46), bucketFor(190), bucketFor(191)]).toEqual(["day", "day", "week", "week", "month"]);
  });
  it("formats periods", () => {
    expect(formatRange("2026-10-01", "2026-10-15")).toBe("1 Oct – 15 Oct 2026");
    expect(formatRange("2025-12-01", "2026-01-31")).toBe("1 Dec 2025 – 31 Jan 2026");
    expect(formatRange("2026-10-15", "2026-10-15")).toBe("15 Oct 2026");
  });
});
