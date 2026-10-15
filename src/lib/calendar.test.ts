import { describe, expect, it } from "vitest";
import { addMonths, groupByLocalDate, isDateString, monthGrid, startOfWeek, todayIn, utcRange, weekDays } from "./calendar";

describe("calendar helpers", () => {
  it("validates date strings", () => {
    expect(isDateString("2026-10-15")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("15/10/2026")).toBe(false);
    expect(isDateString(undefined)).toBe(false);
  });

  it("builds Monday-first month grids", () => {
    const grid = monthGrid("2026-10-15");
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid.at(-1)?.at(-1)).toBe("2026-11-01");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid("2027-02-10")).toHaveLength(4); // Feb 2027 starts on a Monday
  });

  it("moves between months and weeks", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
    expect(weekDays("2026-10-15")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });

  it("converts ranges and groups sessions by local date in the business time zone", () => {
    expect(utcRange("2026-10-12", "2026-10-18", "Asia/Kolkata")).toEqual({ from: "2026-10-11T18:30:00.000Z", to: "2026-10-18T18:30:00.000Z" });
    const grouped = groupByLocalDate([{ starts_at: "2026-10-16T20:00:00Z" }, { starts_at: "2026-10-17T05:30:00Z" }], "Asia/Kolkata");
    expect([...grouped.keys()]).toEqual(["2026-10-17"]);
    expect(grouped.get("2026-10-17")).toHaveLength(2);
    expect(todayIn("Asia/Kolkata", new Date("2026-10-15T20:00:00Z"))).toBe("2026-10-16");
  });
});
