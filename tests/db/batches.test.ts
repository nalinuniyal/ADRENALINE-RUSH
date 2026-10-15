import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, createTestDatabase } from "./harness";
import { seedOrg, user, type Org } from "./fixtures";

let db: Client;
let drop: () => Promise<void>;
let o: Org;
let courseId: string;
let otherCourseId: string;
const cand: Record<string, string> = {};

async function q<T = Record<string, unknown>>(who: Parameters<typeof as>[1], sql: string, params: unknown[] = [], commit = true) {
  return as(db, who, async (c) => (await c.query(sql, params)).rows as T[], commit);
}
const owner = () => user(o.ownerId);

async function newBatch(name: string, extra: Record<string, unknown> = {}, course = courseId): Promise<string> {
  const cols = { organization_id: o.orgId, course_id: course, name, timezone: "Asia/Kolkata", status: "open", ...extra };
  const keys = Object.keys(cols);
  const rows = await q<{ id: string }>(
    owner(),
    `insert into public.batches (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(cols),
  );
  return rows[0].id;
}

const enroll = (who: Parameters<typeof as>[1], candidateId: string, batchId: string, by: string, status = "active") =>
  q<{ id: string }>(
    who,
    "insert into public.enrollments (organization_id, candidate_id, batch_id, course_id, status, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
    [o.orgId, candidateId, batchId, courseId, status, by],
  );

async function newSession(batchId: string | null, startsAt: string, extra: Record<string, unknown> = {}): Promise<string> {
  const rows = await q<{ id: string }>(
    owner(),
    `insert into public.class_sessions (organization_id, kind, batch_id, course_id, title, starts_at, ends_at, timezone, meeting_url)
     values ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '2 hours', 'Asia/Kolkata', $7) returning id`,
    [o.orgId, batchId ? "class" : "demo", batchId, courseId, extra.title ?? "Class", startsAt, extra.meeting_url ?? null],
  );
  return rows[0].id;
}

const mark = (who: Parameters<typeof as>[1], sessionId: string, candidateId: string, status = "present") =>
  q(
    who,
    `insert into public.attendance_records (organization_id, session_id, candidate_id, status) values ($1, $2, $3, $4)
     on conflict (session_id, candidate_id) do update set status = excluded.status returning *`,
    [o.orgId, sessionId, candidateId, status],
  );

beforeAll(async () => {
  ({ client: db, drop } = await createTestDatabase());
  o = await seedOrg(db);
  const courses = await q<{ id: string }>(
    owner(),
    "insert into public.courses (organization_id, title, slug, status) values ($1, 'Synthetic Batch Course', 'synthetic-batch', 'published'), ($1, 'Other Course', 'other-course', 'published') returning id",
    [o.orgId],
  );
  [courseId, otherCourseId] = courses.map((c) => c.id);
  for (const [key, name] of [["a", "Asha Example"], ["b", "Bala Example"], ["c", "Chen Example"], ["d", "Dev Example"], ["e", "Esha Example"]]) {
    const rows = await q<{ id: string }>(owner(), "insert into public.candidates (organization_id, full_name, email) values ($1, $2, $3) returning id", [
      o.orgId,
      name,
      `${key}@example.test`,
    ]);
    cand[key] = rows[0].id;
  }
  // Staff own candidate "e" only.
  await q(owner(), "update public.candidates set owner_id = $1 where id = $2", [o.staffId, cand.e]);
});
afterAll(async () => drop?.());

describe("batches", () => {
  it("owners create batches; staff and instructors cannot", async () => {
    const id = await newBatch("Oct Weekend", { capacity: 2, class_days: [6, 0, 6], start_time: "11:00", end_time: "13:00" });
    const rows = await q<{ class_days: number[]; status: string }>(owner(), "select class_days, status from public.batches where id = $1", [id]);
    expect(rows[0].class_days).toEqual([0, 6]);
    for (const who of [o.staffId, o.instructorId]) {
      await expect(
        q(user(who), "insert into public.batches (organization_id, course_id, name) values ($1, $2, 'Nope')", [o.orgId, courseId], false),
      ).rejects.toThrow(/row-level security/);
    }
  });

  it("validates time zone, instructor membership and the course's organization", async () => {
    await expect(newBatch("Bad TZ", { timezone: "Mars/Olympus" })).rejects.toThrow(/Invalid time zone/);
    await expect(newBatch("Bad instructor", { instructor_id: o.outsiderId })).rejects.toThrow(/active team member/);
    await expect(newBatch("Bad times", { start_time: "13:00", end_time: "11:00" })).rejects.toThrow(/check constraint/);
  });

  it("instructors see only the batches they teach; staff see all; outsiders and anon see none", async () => {
    const mine = await newBatch("Instructor Batch", { instructor_id: o.instructorId });
    const seenByInstructor = await q<{ id: string }>(user(o.instructorId), "select id from public.batches");
    expect(seenByInstructor.map((r) => r.id)).toEqual([mine]);
    const seenByStaff = await q(user(o.staffId), "select id from public.batches");
    expect(seenByStaff.length).toBeGreaterThan(1);
    expect(await q(user(o.outsiderId), "select id from public.batches")).toHaveLength(0);
    await expect(q({ role: "anon" }, "select id from public.batches")).rejects.toThrow(/permission denied/);
    for (const t of ["enrollments", "class_sessions", "attendance_records", "session_attendees", "google_integrations"]) {
      await expect(q({ role: "anon" }, `select 1 from public.${t}`)).rejects.toThrow(/permission denied/);
    }
  });

  it("audits batch changes", async () => {
    const id = await newBatch("Audited");
    await q(owner(), "update public.batches set capacity = 5 where id = $1", [id]);
    const rows = await db.query("select action from public.audit_logs where entity_id = $1 order by id", [id]);
    expect(rows.rows.map((r) => r.action)).toEqual(["batch.created", "batch.updated"]);
  });
});

describe("enrollments", () => {
  let full: string;

  it("enrolling moves the lead to Enrolled and logs the timeline", async () => {
    full = (await q<{ id: string }>(owner(), "select id from public.batches where name = 'Oct Weekend'"))[0].id;
    const [e] = await enroll(owner(), cand.a, full, o.ownerId);
    const status = await db.query("select s.key from public.candidates c join public.lead_statuses s on s.id = c.lead_status_id where c.id = $1", [cand.a]);
    expect(status.rows[0].key).toBe("enrolled");
    const acts = await db.query("select type from public.candidate_activities where candidate_id = $1 order by id", [cand.a]);
    expect(acts.rows.map((r) => r.type)).toEqual(expect.arrayContaining(["enrolled", "status_changed"]));
    const audit = await db.query("select count(*)::int n from public.audit_logs where entity_id = $1 and action = 'enrollment.created'", [e.id]);
    expect(audit.rows[0].n).toBe(1);
  });

  it("prevents duplicate enrollment in the same batch", async () => {
    await expect(enroll(owner(), cand.a, full, o.ownerId)).rejects.toThrow(/already enrolled/);
  });

  it("enforces capacity and toggles the batch between open and full", async () => {
    await enroll(owner(), cand.b, full, o.ownerId);
    const st = await db.query("select status from public.batches where id = $1", [full]);
    expect(st.rows[0].status).toBe("full");
    await expect(enroll(owner(), cand.c, full, o.ownerId)).rejects.toThrow(/This batch is full \(2 of 2/);
    // Dropping frees the seat and reopens the batch; the dropped person may re-enroll later.
    await q(owner(), "update public.enrollments set status = 'dropped' where candidate_id = $1 and batch_id = $2", [cand.b, full]);
    expect((await db.query("select status from public.batches where id = $1", [full])).rows[0].status).toBe("open");
    await enroll(owner(), cand.c, full, o.ownerId);
    await expect(q(owner(), "update public.enrollments set status = 'active' where candidate_id = $1 and batch_id = $2", [cand.b, full])).rejects.toThrow(
      /full/,
    );
  });

  it("serialises concurrent enrollments so capacity cannot be exceeded", async () => {
    const tight = await newBatch("One seat", { capacity: 1 });
    const second = new Client(connectionOf(db));
    await second.connect();
    try {
      const claims = (id: string) => JSON.stringify({ sub: id, role: "authenticated" });
      for (const c of [db, second]) {
        await c.query("begin");
        await c.query("select set_config('request.jwt.claims', $1, true)", [claims(o.ownerId)]);
        await c.query("set local role authenticated");
      }
      const ins = (c: Client, cid: string) =>
        c.query("insert into public.enrollments (organization_id, candidate_id, batch_id, course_id, created_by) values ($1, $2, $3, $4, $5)", [
          o.orgId,
          cid,
          tight,
          courseId,
          o.ownerId,
        ]);
      await ins(db, cand.d);
      const pending = ins(second, cand.e).then(
        () => "ok",
        (e: Error) => e.message,
      );
      await new Promise((r) => setTimeout(r, 200));
      await db.query("commit");
      const outcome = await pending;
      await second.query("rollback");
      expect(outcome).toMatch(/This batch is full/);
    } finally {
      await second.end();
    }
  });

  it("refuses enrollments into cancelled or completed batches", async () => {
    const done = await newBatch("Finished", { status: "completed" });
    await expect(enroll(owner(), cand.a, done, o.ownerId)).rejects.toThrow(/This batch is completed/);
  });

  it("transfers keep the same enrollment and only work within the course", async () => {
    const from = await newBatch("Transfer From");
    const to = await newBatch("Transfer To");
    const other = await newBatch("Other Course Batch", {}, otherCourseId);
    const [e] = await enroll(owner(), cand.d, from, o.ownerId);
    await q(owner(), "update public.enrollments set batch_id = $1 where id = $2", [to, e.id]);
    const moved = await db.query("select batch_id from public.enrollments where id = $1", [e.id]);
    expect(moved.rows[0].batch_id).toBe(to);
    await expect(q(owner(), "update public.enrollments set batch_id = $1 where id = $2", [other, e.id])).rejects.toThrow(/same course/);
    const acts = await db.query("select summary from public.candidate_activities where candidate_id = $1 and type = 'enrollment_transferred'", [cand.d]);
    expect(acts.rows[0].summary).toBe("Transferred from Transfer From to Transfer To · Synthetic Batch Course");
  });

  it("staff enroll only candidates assigned to them; instructors cannot enroll", async () => {
    const open = await newBatch("Staff Batch");
    await expect(enroll(user(o.staffId), cand.c, open, o.staffId)).rejects.toThrow(/row-level security/);
    await enroll(user(o.staffId), cand.e, open, o.staffId);
    await expect(enroll(user(o.instructorId), cand.c, open, o.instructorId)).rejects.toThrow(/row-level security/);
    // Fee/payment columns do not exist here: finance references enrollments.id.
    const cols = await db.query("select column_name from information_schema.columns where table_name = 'enrollments'");
    expect(cols.rows.map((r) => r.column_name)).not.toContain("agreed_fee");
  });

  it("rosters show names to the batch's instructor but not to other instructors", async () => {
    const taught = await newBatch("Taught", { instructor_id: o.instructorId });
    await enroll(owner(), cand.c, taught, o.ownerId);
    const roster = await q<{ full_name: string; email: string; can_view_candidate: boolean }>(user(o.instructorId), "select * from public.get_batch_roster($1)", [taught]);
    expect(roster).toEqual([expect.objectContaining({ full_name: "Chen Example", email: "c@example.test", can_view_candidate: false })]);
    expect(await q(user(o.instructorId), "select * from public.get_batch_roster($1)", [full])).toHaveLength(0);
    // Staff see the roster but contact details only for their own candidates.
    const staffView = await q<{ full_name: string; email: string | null }>(user(o.staffId), "select * from public.get_batch_roster($1)", [taught]);
    expect(staffView[0]).toMatchObject({ full_name: "Chen Example", email: null });
  });
});

describe("sessions and attendance", () => {
  let taught: string;
  let past: string;

  beforeAll(async () => {
    taught = (await q<{ id: string }>(owner(), "select id from public.batches where name = 'Taught'"))[0].id;
    past = await newSession(taught, new Date(Date.now() - 3 * 864e5).toISOString(), { meeting_url: "https://meet.example.test/abc" });
  });

  it("derives the course from the batch, marks manual links and blocks duplicate times", async () => {
    const rows = await db.query("select course_id, meeting_source from public.class_sessions where id = $1", [past]);
    expect(rows.rows[0]).toEqual({ course_id: courseId, meeting_source: "manual" });
    const at = (await db.query("select starts_at from public.class_sessions where id = $1", [past])).rows[0].starts_at.toISOString();
    await expect(newSession(taught, at)).rejects.toThrow(/duplicate key/);
    await expect(
      q(owner(), "insert into public.class_sessions (organization_id, kind, course_id, title, starts_at, ends_at) values ($1, 'class', $2, 'x', now(), now() + interval '1 hour')", [
        o.orgId,
        courseId,
      ]),
    ).rejects.toThrow(/check constraint/);
  });

  it("members cannot write Google fields; only staff with sessions.manage write sessions", async () => {
    await expect(q(owner(), "update public.class_sessions set google_event_id = 'abcde' where id = $1", [past], false)).rejects.toThrow(/permission denied/);
    await expect(q(user(o.staffId), "update public.class_sessions set title = 'x' where id = $1 returning id", [past], false).then((r) => r.length)).resolves.toBe(0);
  });

  it("instructors see sessions of their batches only", async () => {
    const otherBatch = (await q<{ id: string }>(owner(), "select id from public.batches where name = 'Oct Weekend'"))[0].id;
    const hidden = await newSession(otherBatch, new Date(Date.now() - 2 * 864e5).toISOString());
    const seen = await q<{ id: string }>(user(o.instructorId), "select id from public.class_sessions");
    expect(seen.map((r) => r.id)).toContain(past);
    expect(seen.map((r) => r.id)).not.toContain(hidden);
  });

  it("instructors record attendance for enrolled students; who and when are stamped", async () => {
    const [r] = await mark(user(o.instructorId), past, cand.c, "late");
    expect(r).toMatchObject({ status: "late", recorded_by: o.instructorId });
    expect(r.enrollment_id).toBeTruthy();
    const people = await q<{ full_name: string; attendance: string }>(user(o.instructorId), "select * from public.get_session_people($1)", [past]);
    expect(people).toEqual([expect.objectContaining({ full_name: "Chen Example", attendance: "late" })]);
  });

  it("rejects attendance for people not enrolled, cancelled sessions, future sessions and staff without the permission", async () => {
    await expect(mark(owner(), past, cand.a)).rejects.toThrow(/not enrolled/);
    await expect(mark(user(o.staffId), past, cand.c)).rejects.toThrow(/row-level security/);
    const future = await newSession(taught, new Date(Date.now() + 5 * 864e5).toISOString());
    await expect(mark(owner(), future, cand.c)).rejects.toThrow(/Attendance opens/);
    const cancelled = await newSession(taught, new Date(Date.now() - 864e5).toISOString());
    await q(owner(), "update public.class_sessions set status = 'cancelled' where id = $1", [cancelled]);
    await expect(mark(owner(), cancelled, cand.c)).rejects.toThrow(/cancelled session/);
    const other = (await q<{ id: string }>(owner(), "select id from public.batches where name = 'Oct Weekend'"))[0].id;
    const notMine = await newSession(other, new Date(Date.now() - 4 * 864e5).toISOString());
    await expect(mark(user(o.instructorId), notMine, cand.a)).rejects.toThrow(/row-level security/);
  });

  it("demo sessions take invitees only and attending moves the lead to Demo Attended", async () => {
    const demo = await newSession(null, new Date(Date.now() - 864e5).toISOString(), { title: "Free demo" });
    const [fresh] = await q<{ id: string }>(owner(), "insert into public.candidates (organization_id, full_name, email) values ($1, 'Demo Person', 'demo@example.test') returning id", [o.orgId]);
    await expect(mark(owner(), demo, fresh.id)).rejects.toThrow(/not invited/);
    await q(owner(), "insert into public.session_attendees (session_id, candidate_id, organization_id, added_by) values ($1, $2, $3, $4)", [demo, fresh.id, o.orgId, o.ownerId]);
    await expect(
      q(owner(), "insert into public.session_attendees (session_id, candidate_id, organization_id) values ($1, $2, $3)", [past, fresh.id, o.orgId]),
    ).rejects.toThrow(/demo sessions/);
    await mark(owner(), demo, fresh.id, "present");
    const status = await db.query("select s.key from public.candidates c join public.lead_statuses s on s.id = c.lead_status_id where c.id = $1", [fresh.id]);
    expect(status.rows[0].key).toBe("demo_attended");
  });
});

describe("google integration storage", () => {
  it("keeps tokens out of reach of API roles", async () => {
    await as(db, { role: "service_role" }, (c) =>
      c.query("insert into public.google_integrations (organization_id, refresh_token_encrypted, connected_by, connected_at) values ($1, 'v1:x', $2, now())", [o.orgId, o.ownerId]), true);
    const status = await q<{ status: string }>(owner(), "select status, connected_by from public.google_integrations");
    expect(status[0].status).toBe("connected");
    await expect(q(owner(), "select refresh_token_encrypted from public.google_integrations")).rejects.toThrow(/permission denied/);
    await expect(q(owner(), "update public.google_integrations set status = 'error'")).rejects.toThrow(/permission denied/);
    expect(await q(user(o.instructorId), "select status from public.google_integrations")).toHaveLength(0);
  });
});

function connectionOf(c: Client) {
  const p = c as unknown as { host: string; port: number; user: string; password: string; database: string };
  return { host: p.host, port: p.port, user: p.user, password: p.password, database: p.database };
}
