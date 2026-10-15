import { describe, expect, it } from "vitest";
import { attendanceSchema, batchSchema, enrollSchema, generateSessionsSchema, sessionSchema } from "./batches";

const ID = "7f1d8a52-0c55-4c7f-9a52-3d0b6c1e9a10";

const batch = {
  courseId: ID,
  name: "October Weekend",
  code: "",
  startDate: "2026-10-17",
  endDate: "2026-12-20",
  timezone: "Asia/Kolkata",
  classDays: ["6", "0", "6"],
  startTime: "11:00",
  endTime: "13:00",
  scheduleNote: "",
  capacity: "20",
  deliveryMode: "online",
  instructorId: "",
  defaultMeetingUrl: "",
  status: "open",
  notes: "",
};

describe("batchSchema", () => {
  it("normalises form input", () => {
    const v = batchSchema.parse(batch);
    expect(v).toMatchObject({ classDays: [0, 6], capacity: 20, code: null, instructorId: null, defaultMeetingUrl: null });
  });

  it("rejects bad dates, times, links and time zones", () => {
    const fieldsOf = (input: object) => Object.keys(batchSchema.safeParse(input).error?.flatten().fieldErrors ?? {});
    expect(fieldsOf({ ...batch, defaultMeetingUrl: "http://meet.example.test", timezone: "Nowhere/City", capacity: "0" })).toEqual(
      expect.arrayContaining(["defaultMeetingUrl", "timezone", "capacity"]),
    );
    expect(fieldsOf({ ...batch, endDate: "2026-10-01", endTime: "10:00" })).toEqual(expect.arrayContaining(["endDate", "endTime"]));
  });

  it("requires both times or neither", () => {
    expect(batchSchema.safeParse({ ...batch, endTime: "" }).success).toBe(false);
    expect(batchSchema.safeParse({ ...batch, startTime: "", endTime: "" }).success).toBe(true);
  });
});

describe("sessionSchema", () => {
  const base = { kind: "class", batchId: ID, title: "Class 1", date: "2026-10-17", startTime: "11:00", endTime: "13:00", timezone: "Asia/Kolkata", meetingMode: "manual", meetingUrl: "https://meet.google.com/abc-defg-hij", status: "scheduled", addAttendees: false };

  it("accepts a class with a manual link", () => {
    expect(sessionSchema.parse(base)).toMatchObject({ meetingMode: "manual", meetingUrl: "https://meet.google.com/abc-defg-hij" });
  });

  it("needs a link for manual mode, a batch for classes and a course for demos", () => {
    expect(sessionSchema.safeParse({ ...base, meetingUrl: "" }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...base, batchId: "" }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...base, kind: "demo", batchId: "", courseId: "" }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...base, kind: "demo", batchId: "", courseId: ID, attendeeIds: [ID, ID, "x"] }).data?.attendeeIds).toEqual([ID]);
  });

  it("rejects javascript: and plain http links", () => {
    expect(sessionSchema.safeParse({ ...base, meetingUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...base, recordingUrl: "http://example.test/rec" }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("generate needs weeks or an end date and at least one day", () => {
    const g = { batchId: ID, startDate: "2026-10-17", days: ["6"], startTime: "11:00", endTime: "13:00", titlePrefix: "Class" };
    expect(generateSessionsSchema.safeParse(g).success).toBe(false);
    expect(generateSessionsSchema.parse({ ...g, weeks: "8" })).toMatchObject({ weeks: 8, days: [6] });
    expect(generateSessionsSchema.safeParse({ ...g, weeks: "8", days: [] }).success).toBe(false);
  });

  it("enroll defaults to active and attendance allows clearing a mark", () => {
    expect(enrollSchema.parse({ batchId: ID, candidateId: ID }).status).toBe("active");
    expect(attendanceSchema.parse({ sessionId: ID, marks: [{ candidateId: ID, status: "", note: "" }] }).marks[0]).toEqual({ candidateId: ID, status: "", note: null });
  });
});
