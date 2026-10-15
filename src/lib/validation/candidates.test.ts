import { describe, expect, it } from "vitest";
import {
  autoMapColumns,
  buildImportPreview,
  candidateCreateSchema,
  candidateDetailsSchema,
  candidateFiltersQuery,
  combinedOrFilter,
  followUpSchema,
  importCommitSchema,
  leadStatusKey,
  leadStatusSchema,
  normalizeEmail,
  parseCandidateFilters,
  phoneMatchKey,
  searchConditions,
  sourceConditions,
  summarizePreview,
  uniqueKey,
} from "./candidates";

const ID = "6f1c2c1e-8a4b-4c1d-9e2f-0a1b2c3d4e5f";

describe("normalisation mirrors the database", () => {
  it.each([
    [" Asha@Example.TEST ", "asha@example.test"],
    ["", null],
    [null, null],
  ])("normalizeEmail(%s)", (input, out) => expect(normalizeEmail(input)).toBe(out));

  it.each([
    ["+91 98765 43210", "9876543210"],
    ["09876543210", "9876543210"],
    ["98765-43210", "9876543210"],
    ["12345", "12345"],
    ["no digits", null],
  ])("phoneMatchKey(%s)", (input, out) => expect(phoneMatchKey(input)).toBe(out));
});

describe("candidateDetailsSchema", () => {
  const base = { fullName: " Asha Example ", email: "", phone: "+91 98765 43210" };

  it("trims, turns blanks into null and defaults consent to false", () => {
    const r = candidateDetailsSchema.parse({ ...base, company: "  ", totalExperienceYears: "4.25" });
    expect(r.fullName).toBe("Asha Example");
    expect(r.email).toBeNull();
    expect(r.company).toBeNull();
    expect(r.totalExperienceYears).toBe(4.3);
    expect(r.marketingConsent).toBe(false);
    expect(r.privacyConsent).toBe(false);
  });

  it("requires an email or a phone", () => {
    const r = candidateDetailsSchema.safeParse({ fullName: "X", email: "", phone: "" });
    expect(r.success).toBe(false);
    expect(r.error!.flatten().fieldErrors.email?.[0]).toMatch(/email address or a phone/);
  });

  it.each([
    ["bad email", { email: "nope" }, "email"],
    ["bad phone", { phone: "call me" }, "phone"],
    ["missing name", { fullName: "  " }, "fullName"],
    ["experience out of range", { totalExperienceYears: "70" }, "totalExperienceYears"],
    ["experience not a number", { relevantExperienceYears: "abc" }, "relevantExperienceYears"],
    ["long company", { company: "x".repeat(161) }, "company"],
  ])("rejects %s", (_n, patch, field) => {
    const r = candidateDetailsSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain(field);
  });

  it("lower-cases email", () => {
    expect(candidateDetailsSchema.parse({ ...base, email: "A@B.TEST" }).email).toBe("a@b.test");
  });
});

describe("candidateCreateSchema", () => {
  it("accepts empty optional ids as null and rejects malformed ids", () => {
    const ok = candidateCreateSchema.parse({ fullName: "A", phone: "+91 98765 43210", leadStatusId: "", ownerId: ID, courseId: undefined });
    expect(ok).toMatchObject({ leadStatusId: null, ownerId: ID, courseId: null });
    const bad = candidateCreateSchema.safeParse({ fullName: "A", phone: "+91 98765 43210", ownerId: "1; drop table" });
    expect(bad.success).toBe(false);
  });
});

describe("followUpSchema", () => {
  const base = { candidateId: ID, title: "Call back", dueDate: "2026-11-02", dueTime: "19:30" };
  it("accepts a valid follow-up", () => expect(followUpSchema.parse(base).assignedTo).toBeNull());
  it.each([
    [{ dueTime: "25:00" }, "dueTime"],
    [{ dueDate: "02/11/2026" }, "dueDate"],
    [{ title: "" }, "title"],
  ])("rejects %o", (patch, field) => {
    const r = followUpSchema.safeParse({ ...base, ...patch });
    expect(Object.keys(r.error!.flatten().fieldErrors)).toContain(field);
  });
});

describe("lead statuses", () => {
  it("requires won statuses to be closed", () => {
    expect(leadStatusSchema.safeParse({ label: "Paid", color: "success", isClosed: false, isWon: true }).success).toBe(false);
    expect(leadStatusSchema.safeParse({ label: "Paid", color: "success", isClosed: true, isWon: true }).success).toBe(true);
    expect(leadStatusSchema.safeParse({ label: "Paid", color: "pink" }).success).toBe(false);
  });

  it.each([
    ["Call back later!", "call_back_later"],
    ["  Démo — Shared ", "demo_shared"],
    ["2nd call", "nd_call"],
    ["!!!", "status"],
  ])("leadStatusKey(%s)", (label, key) => {
    expect(leadStatusKey(label)).toBe(key);
    expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });

  it("makes keys unique", () => {
    expect(uniqueKey("new", ["new", "new_2"])).toBe("new_3");
    expect(uniqueKey("fresh", ["new"])).toBe("fresh");
  });
});

describe("list filters", () => {
  it("parses the dashboard links", () => {
    expect(parseCandidateFilters({ sort: "newest" }).sort).toBe("newest");
    expect(parseCandidateFilters({ followup: "overdue" }).followup).toBe("overdue");
  });

  it("ignores invalid values instead of failing", () => {
    const f = parseCandidateFilters({ status: "x", owner: "someone", sort: "evil", page: "-3", followup: "soon", q: "  " });
    expect(f).toEqual({ q: null, status: null, course: null, owner: null, source: null, followup: null, sort: "newest", page: 1 });
  });

  it("keeps valid values and round-trips through the query string", () => {
    const f = parseCandidateFilters({ q: " Asha  Ex ", status: ID, owner: "unassigned", sort: "name", page: "3", source: ["linkedin", "x"] });
    expect(f).toMatchObject({ q: "Asha Ex", status: ID, owner: "unassigned", sort: "name", page: 3, source: "linkedin" });
    const qs = candidateFiltersQuery(f, { page: 1 });
    expect(qs).not.toContain("page=");
    expect(parseCandidateFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual({ ...f, page: 1 });
  });
});

describe("PostgREST filter building", () => {
  it("strips characters that could change the filter structure", () => {
    const conds = searchConditions('a),or(id.eq."x"*%:');
    for (const c of conds) expect(c).toMatch(/^[a-z_]+\.(ilike|like)\."[^"(),]*"$/);
  });

  it("adds a phone-key condition for digit searches", () => {
    expect(searchConditions("+91 98765 43210")).toContain('phone_key.like."%9876543210%"');
    expect(searchConditions("asha").some((c) => c.startsWith("phone_key"))).toBe(false);
  });

  it("combines groups with AND and members with OR", () => {
    expect(combinedOrFilter([[], []])).toBeNull();
    expect(combinedOrFilter([["a.eq.1", "b.eq.1"], []])).toBe("a.eq.1,b.eq.1");
    expect(combinedOrFilter([["a.eq.1"], sourceConditions("linkedin")])).toBe('and(or(a.eq.1),or(source.ilike."linkedin",utm_source.ilike."linkedin"))');
  });
});

describe("CSV import", () => {
  const ctx = { statuses: [{ key: "interested", label: "Interested" }], courseSlugs: ["data-101"] };

  it("auto-maps common header names, each field once", () => {
    expect(autoMapColumns(["Name", "E-mail", "Mobile Number", "utm_source", "Status", "Course", "Unknown", "Full Name"])).toEqual([
      "full_name",
      "email",
      "phone",
      "utm_source",
      "lead_status",
      "course_slug",
      null,
      null,
    ]);
  });

  it("validates rows and flags duplicates within the file and against existing candidates", () => {
    const mapping = autoMapColumns(["Name", "Email", "Phone", "Status", "Course"]);
    const rows = [
      ["Asha", "asha@example.test", "+91 98765 43210", "interested", "data-101"],
      ["Asha again", "ASHA@example.test", "", "", ""],
      ["Phone twin", "", "09876543210", "", ""],
      ["", "x@example.test", "", "", ""],
      ["Bad", "not-an-email", "", "Unknown", "nope"],
      ["Existing", "old@example.test", "", "", ""],
      ["Fresh", "", "+1 (555) 010-0000", "Interested", "DATA-101"],
    ];
    const preview = buildImportPreview(rows, mapping, { ...ctx, existingEmails: new Set(["old@example.test"]) });
    expect(preview[0]).toMatchObject({ errors: [], duplicateOfRow: null, existing: false });
    expect(preview[1].duplicateOfRow).toBe(1);
    expect(preview[2].duplicateOfRow).toBe(1);
    expect(preview[3].errors).toContain("Name is missing");
    expect(preview[4].errors).toEqual(["Email address is not valid", "Unknown lead status “Unknown”", "Unknown course “nope”"]);
    expect(preview[5].existing).toBe(true);
    expect(preview[6].errors).toEqual([]);
    expect(summarizePreview(preview)).toEqual({ ready: 2, invalid: 2, duplicates: 3, total: 7 });
  });

  it("limits the commit payload", () => {
    expect(importCommitSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(importCommitSchema.safeParse({ rows: Array.from({ length: 5001 }, () => ({ full_name: "a", email: "a@b.c" })) }).success).toBe(false);
    expect(importCommitSchema.safeParse({ rows: [{ full_name: "x".repeat(161) }] }).success).toBe(false);
    expect(importCommitSchema.parse({ rows: [{ full_name: "A", phone: "1234567" }], ownerId: "", fileName: " leads.csv " })).toEqual({
      rows: [{ full_name: "A", phone: "1234567" }],
      ownerId: null,
      fileName: "leads.csv",
    });
  });
});
