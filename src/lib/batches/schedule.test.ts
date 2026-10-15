import { describe, expect, it } from "vitest";
import { addDays, generateSchedule, MAX_GENERATED_SESSIONS, scheduleSummary, weekdayOf } from "./schedule";

describe("generateSchedule", () => {
  it("creates every Sat/Sun 11:00 class for N weeks in Asia/Kolkata", () => {
    // 2026-10-17 is a Saturday.
    const out = generateSchedule({ startDate: "2026-10-17", weeks: 4, days: [6, 0], startTime: "11:00", endTime: "13:00", timeZone: "Asia/Kolkata" });
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual({ date: "2026-10-17", startsAt: "2026-10-17T05:30:00.000Z", endsAt: "2026-10-17T07:30:00.000Z" });
    expect(out[1].date).toBe("2026-10-18");
    expect(out.at(-1)?.date).toBe("2026-11-08");
    expect(out.every((s) => [0, 6].includes(weekdayOf(s.date)))).toBe(true);
  });

  it("starts mid-week and respects an end date (inclusive)", () => {
    const out = generateSchedule({ startDate: "2026-10-15", endDate: "2026-10-22", days: [1, 3], startTime: "19:30", endTime: "21:00", timeZone: "Asia/Kolkata" });
    expect(out.map((s) => s.date)).toEqual(["2026-10-19", "2026-10-21"]);
    expect(out[0].startsAt).toBe("2026-10-19T14:00:00.000Z");
  });

  it("keeps local wall-clock time across a daylight-saving change", () => {
    // US clocks go back on 2026-11-01.
    const out = generateSchedule({ startDate: "2026-10-25", weeks: 2, days: [0], startTime: "19:00", endTime: "20:00", timeZone: "America/New_York" });
    expect(out.map((s) => s.startsAt)).toEqual(["2026-10-25T23:00:00.000Z", "2026-11-02T00:00:00.000Z"]);
  });

  it("handles a session that crosses midnight UTC", () => {
    const [s] = generateSchedule({ startDate: "2026-10-17", weeks: 1, days: [6], startTime: "04:00", endTime: "06:00", timeZone: "Asia/Kolkata" });
    expect(s.startsAt).toBe("2026-10-16T22:30:00.000Z");
  });

  it("rejects bad input and caps the number of sessions", () => {
    const base = { startDate: "2026-10-17", days: [6], startTime: "11:00", endTime: "13:00", timeZone: "Asia/Kolkata" };
    expect(() => generateSchedule({ ...base })).toThrow(/end date or a number of weeks/);
    expect(() => generateSchedule({ ...base, weeks: 2, days: [] })).toThrow(/at least one/);
    expect(() => generateSchedule({ ...base, weeks: 2, endTime: "10:00" })).toThrow(/after start/);
    expect(() => generateSchedule({ ...base, endDate: "2026-10-01" })).toThrow(/on or after/);
    expect(generateSchedule({ ...base, weeks: 500, days: [0, 1, 2, 3, 4, 5, 6] })).toHaveLength(MAX_GENERATED_SESSIONS);
  });
});

describe("date helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("summarises a schedule", () => {
    expect(scheduleSummary([0, 6], "11:00:00", "13:00:00")).toBe("Sat, Sun · 11:00–13:00");
    expect(scheduleSummary([], null, null)).toBe("");
  });
});
