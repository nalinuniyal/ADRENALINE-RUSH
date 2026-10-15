import { describe, expect, it } from "vitest";
import { formatPercent, percentTone, summarize, summarizeByCandidate } from "./attendance";

describe("attendance summaries", () => {
  it("counts late as attended and leaves excused out of the percentage", () => {
    expect(summarize(["present", "late", "absent", "excused"])).toEqual({ present: 1, late: 1, absent: 1, excused: 1, attended: 2, percent: 67 });
  });

  it("returns null when nothing countable is marked", () => {
    expect(summarize([]).percent).toBeNull();
    expect(summarize(["excused"]).percent).toBeNull();
    expect(formatPercent(null)).toBe("—");
  });

  it("groups by candidate and ignores sessions outside the batch", () => {
    const map = summarizeByCandidate(
      [
        { candidateId: "a", sessionId: "s1", status: "present" },
        { candidateId: "a", sessionId: "s2", status: "absent" },
        { candidateId: "b", sessionId: "s1", status: "present" },
        { candidateId: "b", sessionId: "other", status: "absent" },
      ],
      new Set(["s1", "s2"]),
    );
    expect(map.get("a")?.percent).toBe(50);
    expect(map.get("b")?.percent).toBe(100);
  });

  it("picks a tone", () => {
    expect([percentTone(90), percentTone(60), percentTone(10), percentTone(null)]).toEqual(["success", "warning", "danger", "neutral"]);
  });
});
