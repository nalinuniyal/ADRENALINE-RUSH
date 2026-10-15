import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Shared values (mirror the enums in 20261014000010_batches_sessions.sql)     */
/* -------------------------------------------------------------------------- */

export const BATCH_STATUSES = ["planned", "open", "full", "running", "completed", "cancelled"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  planned: "Planned",
  open: "Open for enrollment",
  full: "Full",
  running: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ENROLLMENT_STATUSES = ["pending", "active", "on_hold", "completed", "dropped", "cancelled"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  pending: "Pending confirmation",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  dropped: "Dropped",
  cancelled: "Cancelled",
};
/** Statuses that occupy a seat (same as public.enrollment_holds_seat). */
export const SEAT_STATUSES: readonly EnrollmentStatus[] = ["pending", "active", "on_hold", "completed"];

export const SESSION_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = { scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled" };

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export const MEETING_MODES = ["none", "manual", "google"] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

const DELIVERY = ["online", "in_person", "hybrid", "self_paced", "customized"] as const;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const BATCH_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Field helpers                                                               */
/* -------------------------------------------------------------------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const optionalPattern = (re: RegExp, message: string) => optionalText(40).refine((v) => v === null || re.test(v), message);

const optionalDate = optionalPattern(DATE_RE, "Choose a valid date");
const optionalTime = optionalPattern(TIME_RE, "Use a time like 11:00");

export const optionalHttpsUrl = z
  .string()
  .trim()
  .max(500, "Use 500 characters or fewer")
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^https:\/\//i.test(v) && z.url().safeParse(v).success), "Paste a full link starting with https://");

const optionalId = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.guid().safeParse(v).success, "Choose a valid option");

const requiredId = (message: string) => z.string({ error: message }).refine((v) => z.guid().safeParse(v).success, message);

const timeZone = z
  .string()
  .trim()
  .min(1, "Choose a time zone")
  .refine(isValidTimeZone, "Choose a valid time zone, e.g. Asia/Kolkata");

const weekdays = z
  .array(z.union([z.string(), z.number()]))
  .nullable()
  .optional()
  .transform((list, ctx) => {
    const out = new Set<number>();
    for (const v of list ?? []) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 6) {
        ctx.addIssue({ code: "custom", message: "Choose days of the week" });
        return z.NEVER;
      }
      out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  });

const optionalCapacity = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number of seats (1 or more), or leave empty for no limit" });
      return z.NEVER;
    }
    return n;
  });

/* -------------------------------------------------------------------------- */
/* Batches                                                                     */
/* -------------------------------------------------------------------------- */

export const batchSchema = z
  .object({
    courseId: requiredId("Choose a course"),
    name: z.string().trim().min(2, "Enter a batch name (2+ characters)").max(120, "Use 120 characters or fewer"),
    code: optionalPattern(BATCH_CODE_RE, "Use letters, numbers, - or _ (up to 30), e.g. MCP-OCT26"),
    startDate: optionalDate,
    endDate: optionalDate,
    timezone: timeZone,
    classDays: weekdays,
    startTime: optionalTime,
    endTime: optionalTime,
    scheduleNote: optionalText(200),
    capacity: optionalCapacity,
    deliveryMode: z.enum(DELIVERY, { error: "Choose a delivery mode" }),
    instructorId: optionalId,
    defaultMeetingUrl: optionalHttpsUrl,
    status: z.enum(BATCH_STATUSES, { error: "Choose a status" }),
    notes: optionalText(4000),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the start date" });
    if (Boolean(v.startTime) !== Boolean(v.endTime)) ctx.addIssue({ code: "custom", path: [v.startTime ? "endTime" : "startTime"], message: "Give both a start and an end time" });
    if (v.startTime && v.endTime && v.endTime <= v.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "End time must be after the start time" });
  });

export type BatchFormInput = z.input<typeof batchSchema>;
export type BatchFormOutput = z.output<typeof batchSchema>;

export const batchListFilterSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  status: z.enum(["all", "active", ...BATCH_STATUSES]).catch("active"),
  course: z.union([z.uuid(), z.literal("")]).catch(""),
});

/* -------------------------------------------------------------------------- */
/* Enrollments                                                                 */
/* -------------------------------------------------------------------------- */

export const enrollSchema = z.object({
  batchId: requiredId("Choose a batch"),
  candidateId: requiredId("Choose a candidate"),
  status: z.enum(["pending", "active"]).catch("active"),
  notes: optionalText(2000),
});

export const enrollmentStatusSchema = z.object({
  enrollmentId: requiredId("That enrollment could not be found"),
  status: z.enum(ENROLLMENT_STATUSES),
});

export const transferSchema = z.object({
  enrollmentId: requiredId("That enrollment could not be found"),
  batchId: requiredId("Choose the batch to move to"),
});

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export const sessionSchema = z
  .object({
    kind: z.enum(["class", "demo"]),
    batchId: optionalId,
    courseId: optionalId,
    title: z.string().trim().min(1, "Enter a title").max(200, "Use 200 characters or fewer"),
    date: z.string().regex(DATE_RE, "Choose a date"),
    startTime: z.string().regex(TIME_RE, "Use a time like 11:00"),
    endTime: z.string().regex(TIME_RE, "Use a time like 13:00"),
    timezone: timeZone,
    instructorId: optionalId,
    description: optionalText(4000),
    prepNotes: optionalText(4000),
    notes: optionalText(4000),
    meetingMode: z.enum(MEETING_MODES).catch("none"),
    meetingUrl: optionalHttpsUrl,
    recordingUrl: optionalHttpsUrl,
    status: z.enum(SESSION_STATUSES).catch("scheduled"),
    addAttendees: z.boolean().catch(false),
    attendeeIds: z
      .array(z.string())
      .nullable()
      .optional()
      .transform((v) => [...new Set((v ?? []).filter((id) => z.guid().safeParse(id).success))].slice(0, 200)),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "class" && !v.batchId) ctx.addIssue({ code: "custom", path: ["batchId"], message: "Choose a batch" });
    if (v.kind === "demo" && !v.courseId) ctx.addIssue({ code: "custom", path: ["courseId"], message: "Choose the course this demo is for" });
    if (v.endTime <= v.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "End time must be after the start time" });
    if (v.meetingMode === "manual" && !v.meetingUrl) ctx.addIssue({ code: "custom", path: ["meetingUrl"], message: "Paste the meeting link, or choose another option" });
  });

export type SessionFormInput = z.input<typeof sessionSchema>;
export type SessionFormOutput = z.output<typeof sessionSchema>;

export const generateSessionsSchema = z
  .object({
    batchId: requiredId("Choose a batch"),
    startDate: z.string().regex(DATE_RE, "Choose the first date"),
    endDate: optionalDate,
    weeks: z
      .union([z.string(), z.number()])
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 104) {
          ctx.addIssue({ code: "custom", message: "Enter between 1 and 104 weeks" });
          return z.NEVER;
        }
        return n;
      }),
    days: weekdays,
    startTime: z.string().regex(TIME_RE, "Use a time like 11:00"),
    endTime: z.string().regex(TIME_RE, "Use a time like 13:00"),
    titlePrefix: z.string().trim().min(1, "Enter a title").max(150, "Use 150 characters or fewer"),
  })
  .superRefine((v, ctx) => {
    if (!v.endDate && !v.weeks) ctx.addIssue({ code: "custom", path: ["weeks"], message: "Give a number of weeks or an end date" });
    if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be on or after the first date" });
    if (!v.days.length) ctx.addIssue({ code: "custom", path: ["days"], message: "Choose at least one class day" });
    if (v.endTime <= v.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "End time must be after the start time" });
  });

export type GenerateSessionsInput = z.input<typeof generateSessionsSchema>;

export const attendanceSchema = z.object({
  sessionId: requiredId("That session could not be found"),
  marks: z
    .array(
      z.object({
        candidateId: requiredId("Unknown person"),
        status: z.union([z.enum(ATTENDANCE_STATUSES), z.literal("")]),
        note: optionalText(500),
      }),
    )
    .max(500),
});

export const sessionFollowUpSchema = z.object({
  sessionId: requiredId("That session could not be found"),
  recordingUrl: optionalHttpsUrl,
  markCompleted: z.boolean().catch(false),
});

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
