import { describe, expect, it } from "vitest";
import { formatMoney, utcToZonedParts, zonedToUtc } from "./format";

describe("time zones", () => {
  it("converts IST wall clock to UTC and back", () => {
    expect(zonedToUtc("2026-11-02", "19:30", "Asia/Kolkata")).toBe("2026-11-02T14:00:00.000Z");
    expect(utcToZonedParts("2026-11-02T14:00:00.000Z", "Asia/Kolkata")).toEqual({ date: "2026-11-02", time: "19:30" });
  });
  it("handles DST zones", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "Europe/London")).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "Europe/London")).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("formatMoney", () => {
  it("formats INR with Indian grouping", () => {
    expect(formatMoney(150000, "INR")).toBe("₹1,50,000");
    expect(formatMoney("1234.5", "INR")).toBe("₹1,234.50");
    expect(formatMoney(null)).toBe("—");
  });
});
