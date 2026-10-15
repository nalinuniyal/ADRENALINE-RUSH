import { describe, expect, it } from "vitest";
import { formatDuration, parseCurriculum, parseLessonLine, serializeCurriculum } from "./curriculum";

describe("parseLessonLine", () => {
  it.each([
    ["Intro (45m)", "Intro", 45],
    ["Intro (45 min)", "Intro", 45],
    ["Intro (45 minutes)", "Intro", 45],
    ["Deep dive (1h)", "Deep dive", 60],
    ["Deep dive (1h 30m)", "Deep dive", 90],
    ["Deep dive (2 hrs)", "Deep dive", 120],
    ["Lab (0m)", "Lab", null],
    ["Plain lesson", "Plain lesson", null],
    ["Using (parentheses) inside", "Using (parentheses) inside", null],
    ["(45m)", "(45m)", null],
  ])("%s", (input, title, minutes) => {
    expect(parseLessonLine(input)).toEqual({ title, durationMinutes: minutes });
  });
});

describe("parseCurriculum", () => {
  it("parses modules, descriptions and lessons", () => {
    const text = [
      "## Getting started",
      "Set up your tools.",
      "- Welcome (10m)",
      "* Install the CLI",
      "",
      "##   Data modelling  ",
      "- Objects and fields (1h 15m)",
    ].join("\r\n");
    const { modules, issues } = parseCurriculum(text);
    expect(issues).toEqual([]);
    expect(modules).toEqual([
      {
        title: "Getting started",
        description: "Set up your tools.",
        lessons: [
          { title: "Welcome", durationMinutes: 10 },
          { title: "Install the CLI", durationMinutes: null },
        ],
      },
      { title: "Data modelling", description: null, lessons: [{ title: "Objects and fields", durationMinutes: 75 }] },
    ]);
  });

  it("returns an empty curriculum for blank text", () => {
    expect(parseCurriculum("  \n\n ")).toEqual({ modules: [], issues: [] });
  });

  it("reports lessons and text before the first module", () => {
    const { issues } = parseCurriculum("Some intro\n- Orphan lesson\n## Module");
    expect(issues.map((i) => i.line)).toEqual([1, 2]);
  });

  it("reports empty headings and lessons", () => {
    const { issues } = parseCurriculum("##\n## Ok\n-\n- ");
    expect(issues.map((i) => i.line)).toEqual([1, 3, 4]);
  });

  it("reports titles that are too long", () => {
    const { issues } = parseCurriculum(`## ${"x".repeat(201)}\n- ${"y".repeat(201)}`);
    expect(issues).toHaveLength(2);
  });

  it("does not treat ### or -- without a space as markers", () => {
    const { modules, issues } = parseCurriculum("## A\n### Not a module\n--not-a-lesson");
    expect(issues).toEqual([]);
    expect(modules[0].lessons).toEqual([]);
    expect(modules[0].description).toBe("### Not a module\n--not-a-lesson");
  });

  it("round-trips through serializeCurriculum", () => {
    const text = "## One\nAbout one\n- A (1h 5m)\n- B\n\n## Two\n- C (30m)";
    const parsed = parseCurriculum(text);
    expect(serializeCurriculum(parsed.modules)).toBe(text);
    expect(parseCurriculum(serializeCurriculum(parsed.modules)).modules).toEqual(parsed.modules);
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "45m"],
    [60, "1h"],
    [95, "1h 35m"],
  ])("%i → %s", (m, s) => expect(formatDuration(m)).toBe(s));
});
