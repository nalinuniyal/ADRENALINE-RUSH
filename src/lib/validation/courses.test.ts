import { describe, expect, it } from "vitest";
import {
  categorySchema,
  courseListFilterSchema,
  courseSchema,
  formIntegrityIssues,
  INCLUSION_ICON_VALUES,
  integrityErrorForChange,
  MAX_INCLUSIONS,
  mergeSuggestedInclusions,
  nextCopySlug,
  registrationFieldSchema,
  toFieldKey,
  toSlug,
  SUGGESTED_INCLUSIONS,
  uniqueFieldKey,
  type CourseFormInput,
} from "./courses";

const validCourse: CourseFormInput = {
  title: "Salesforce Administrator",
  slug: "salesforce-admin",
  categoryId: "",
  shortDescription: "",
  description: "",
  whoIsItFor: "",
  coverImageUrl: "",
  instructorName: "",
  level: "",
  prerequisites: "",
  learningOutcomes: "",
  durationText: "",
  deliveryMode: "online",
  listPrice: "",
  discountedPrice: "",
  currency: "inr",
  showPrice: true,
  capacity: "",
  enrollmentOpensOn: "",
  enrollmentClosesOn: "",
  certificateDetails: "",
  faqs: [],
  demoUrl: "",
  successMessage: "",
  inclusions: [],
  registrationMode: "demo",
  ctaLabel: "",
  highlightBadge: "",
};

const errorsOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (r.error?.issues ?? []).map((i) => i.path.join("."));

describe("courseSchema", () => {
  it("accepts a minimal course and normalises empty strings to null", () => {
    const r = courseSchema.parse(validCourse);
    expect(r).toMatchObject({ currency: "INR", categoryId: null, listPrice: null, capacity: null, faqs: [], learningOutcomes: [] });
  });

  it("parses prices, capacity, outcomes and FAQs", () => {
    const r = courseSchema.parse({
      ...validCourse,
      listPrice: "4999.50",
      discountedPrice: "3999",
      capacity: "25",
      learningOutcomes: " Build flows \r\n\n Pass the exam ",
      faqs: [
        { q: " Is it live? ", a: " Yes " },
        { q: "", a: "" },
      ],
      enrollmentOpensOn: "2026-11-01",
      enrollmentClosesOn: "2026-11-30",
    });
    expect(r).toMatchObject({
      listPrice: 4999.5,
      discountedPrice: 3999,
      capacity: 25,
      learningOutcomes: ["Build flows", "Pass the exam"],
      faqs: [{ q: "Is it live?", a: "Yes" }],
    });
  });

  it.each([
    ["bad slug", { slug: "Bad Slug" }, "slug"],
    ["double hyphen slug", { slug: "a--b" }, "slug"],
    ["short title", { title: "ab" }, "title"],
    ["http cover image", { coverImageUrl: "http://example.test/a.png" }, "coverImageUrl"],
    ["non-url demo", { demoUrl: "javascript:alert(1)" }, "demoUrl"],
    ["negative price", { listPrice: "-1" }, "listPrice"],
    ["three decimals", { listPrice: "1.234" }, "listPrice"],
    ["zero capacity", { capacity: "0" }, "capacity"],
    ["bad currency", { currency: "RUPEE" }, "currency"],
    ["bad date", { enrollmentOpensOn: "2026-13-45" }, "enrollmentOpensOn"],
    ["bad category", { categoryId: "not-a-uuid" }, "categoryId"],
    ["bad delivery", { deliveryMode: "teleport" }, "deliveryMode"],
    ["faq without answer", { faqs: [{ q: "Why?", a: "" }] }, "faqs.0.a"],
    ["faq without question", { faqs: [{ q: "", a: "Because" }] }, "faqs.0.q"],
  ])("rejects %s", (_name, patch, path) => {
    const r = courseSchema.safeParse({ ...validCourse, ...patch });
    expect(r.success).toBe(false);
    expect(errorsOf(r)).toContain(path);
  });

  it("rejects a discounted price above the list price", () => {
    const r = courseSchema.safeParse({ ...validCourse, listPrice: "100", discountedPrice: "150" });
    expect(errorsOf(r)).toEqual(["discountedPrice"]);
  });

  it("rejects a discounted price without a list price", () => {
    const r = courseSchema.safeParse({ ...validCourse, discountedPrice: "150" });
    expect(errorsOf(r)).toEqual(["discountedPrice"]);
  });

  it("rejects registration closing before it opens", () => {
    const r = courseSchema.safeParse({ ...validCourse, enrollmentOpensOn: "2026-11-10", enrollmentClosesOn: "2026-11-01" });
    expect(errorsOf(r)).toEqual(["enrollmentClosesOn"]);
  });

  it("rejects too many learning outcomes", () => {
    const r = courseSchema.safeParse({ ...validCourse, learningOutcomes: Array.from({ length: 31 }, (_, i) => `O${i}`).join("\n") });
    expect(errorsOf(r)).toEqual(["learningOutcomes"]);
  });
});

describe("categorySchema", () => {
  it("defaults position to 0", () => {
    expect(categorySchema.parse({ name: "Cloud", slug: "cloud", description: "", position: "" })).toEqual({
      name: "Cloud",
      slug: "cloud",
      description: null,
      position: 0,
    });
  });
  it("rejects a bad position", () => {
    expect(categorySchema.safeParse({ name: "Cloud", slug: "cloud", description: "", position: "-1" }).success).toBe(false);
  });
});

describe("registrationFieldSchema", () => {
  const base = { label: "Laptop?", key: "laptop", type: "text" as const, required: false, options: "", helpText: "", placeholder: "" };

  it("drops options for non-choice types", () => {
    expect(registrationFieldSchema.parse({ ...base, options: "A\nB" }).options).toEqual([]);
  });
  it("requires options for choice types and de-duplicates them", () => {
    expect(registrationFieldSchema.safeParse({ ...base, type: "select" }).success).toBe(false);
    expect(registrationFieldSchema.parse({ ...base, type: "radio", options: "Yes\n Yes \nNo\n" }).options).toEqual(["Yes", "No"]);
  });
  it("forces consent fields to be required", () => {
    expect(registrationFieldSchema.parse({ ...base, type: "consent" }).required).toBe(true);
  });
  it.each(["1abc", "Has-Caps", "a".repeat(41), ""])("rejects key %s", (key) => {
    expect(registrationFieldSchema.safeParse({ ...base, key }).success).toBe(false);
  });
});

describe("slug and key helpers", () => {
  it.each([
    ["Salesforce Admin — 2026!", "salesforce-admin-2026"],
    ["Café Ünïcode", "cafe-unicode"],
    ["---", ""],
  ])("toSlug(%s)", (input, out) => expect(toSlug(input)).toBe(out));

  it("keeps slugs within 80 characters", () => {
    expect(toSlug("word ".repeat(40)).length).toBeLessThanOrEqual(80);
  });

  it.each([
    ["Years of experience?", "years_of_experience"],
    ["2nd choice", "q_2nd_choice"],
    ["!!!", ""],
  ])("toFieldKey(%s)", (input, out) => expect(toFieldKey(input)).toBe(out));

  it("avoids taken and reserved keys", () => {
    expect(uniqueFieldKey("laptop", [])).toBe("laptop");
    expect(uniqueFieldKey("laptop", ["laptop", "laptop_2"])).toBe("laptop_3");
    expect(uniqueFieldKey("email", [])).toBe("email_2");
    expect(uniqueFieldKey("", [])).toBe("field");
  });

  it("generates copy slugs", () => {
    expect(nextCopySlug("course", [])).toBe("course-copy");
    expect(nextCopySlug("course", ["course-copy", "course-copy-2"])).toBe("course-copy-3");
    const long = "a".repeat(80);
    expect(nextCopySlug(long, []).length).toBeLessThanOrEqual(80);
    expect(nextCopySlug(long, [])).toMatch(/^a+-copy$/);
  });
});

describe("form integrity", () => {
  const defaults = [
    { key: "full_name", required: true, is_active: true },
    { key: "email", required: true, is_active: true },
    { key: "phone", required: true, is_active: true },
    { key: "privacy_consent", required: true, is_active: true },
  ];
  const change = (key: string, patch: object) => defaults.map((f) => (f.key === key ? { ...f, ...patch } : f));

  it("accepts the default form", () => expect(formIntegrityIssues(defaults)).toEqual([]));
  it("allows making phone optional while email stays required", () => {
    expect(integrityErrorForChange(defaults, change("phone", { required: false }))).toBeNull();
  });
  it("blocks deactivating privacy consent", () => {
    expect(integrityErrorForChange(defaults, change("privacy_consent", { is_active: false }))).toMatch(/privacy/);
  });
  it("blocks making both email and phone optional", () => {
    const before = change("phone", { required: false });
    const after = before.map((f) => (f.key === "email" ? { ...f, required: false } : f));
    expect(integrityErrorForChange(before, after)).toMatch(/email or the phone/);
  });
  it("does not block unrelated edits on an already broken form", () => {
    const broken = change("full_name", { is_active: false });
    expect(integrityErrorForChange(broken, change("full_name", { is_active: false, required: true }))).toBeNull();
  });
});

describe("courseListFilterSchema", () => {
  it("falls back to defaults on junk", () => {
    expect(courseListFilterSchema.parse({ status: "nope", category: "x", page: "-3" })).toEqual({ q: "", status: "all", category: "", page: 1 });
  });
  it("accepts valid filters", () => {
    expect(courseListFilterSchema.parse({ q: " sales ", status: "published", page: "2" })).toMatchObject({ q: "sales", status: "published", page: 2 });
  });
});

describe("course page content", () => {
  it("defaults to a free demo with no custom label or badge", () => {
    const r = courseSchema.safeParse(validCourse);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ inclusions: [], registrationMode: "demo", ctaLabel: null, highlightBadge: null });
  });

  it("keeps filled inclusion rows, drops blank ones and omits empty description/icon", () => {
    const r = courseSchema.safeParse({
      ...validCourse,
      inclusions: [
        { title: "  Interview practice ", description: " Mock interviews ", icon: "mic" },
        { title: "", description: "", icon: "" },
        { title: "Hands-on projects", description: "", icon: "" },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data?.inclusions).toEqual([
      { title: "Interview practice", description: "Mock interviews", icon: "mic" },
      { title: "Hands-on projects" },
    ]);
  });

  it("rejects an inclusion with a description but no title, unknown icons and too many rows", () => {
    expect(errorsOf(courseSchema.safeParse({ ...validCourse, inclusions: [{ title: "", description: "x", icon: "" }] }))).toContain("inclusions.0.title");
    expect(
      errorsOf(courseSchema.safeParse({ ...validCourse, inclusions: [{ title: "A", description: "", icon: "skull" as never }] })),
    ).toContain("inclusions.0.icon");
    const many = Array.from({ length: MAX_INCLUSIONS + 1 }, (_, i) => ({ title: `Item ${i}`, description: "", icon: "" as const }));
    expect(errorsOf(courseSchema.safeParse({ ...validCourse, inclusions: many }))).toContain("inclusions");
    expect(errorsOf(courseSchema.safeParse({ ...validCourse, inclusions: [{ title: "x".repeat(81), description: "", icon: "" }] }))).toContain("inclusions.0.title");
  });

  it("validates registration mode, button label and badge", () => {
    expect(errorsOf(courseSchema.safeParse({ ...validCourse, registrationMode: "paid" as never }))).toContain("registrationMode");
    expect(errorsOf(courseSchema.safeParse({ ...validCourse, ctaLabel: "x".repeat(41) }))).toContain("ctaLabel");
    expect(errorsOf(courseSchema.safeParse({ ...validCourse, highlightBadge: "x".repeat(81) }))).toContain("highlightBadge");
    const ok = courseSchema.safeParse({ ...validCourse, registrationMode: "interest", ctaLabel: " Join the waitlist ", highlightBadge: "Next demo: Saturday 11 AM" });
    expect(ok.data).toMatchObject({ registrationMode: "interest", ctaLabel: "Join the waitlist", highlightBadge: "Next demo: Saturday 11 AM" });
  });

  it("suggested items use allowlisted icons and merge without duplicates", () => {
    for (const s of SUGGESTED_INCLUSIONS) expect(INCLUSION_ICON_VALUES).toContain(s.icon);
    const once = mergeSuggestedInclusions([{ title: "interview PRACTICE", description: "", icon: "" }]);
    expect(once).toHaveLength(SUGGESTED_INCLUSIONS.length);
    expect(once[0].title).toBe("interview PRACTICE");
    expect(mergeSuggestedInclusions(once)).toEqual(once);
    const full = Array.from({ length: MAX_INCLUSIONS - 2 }, (_, i) => ({ title: `Item ${i}`, description: "", icon: "" as const }));
    expect(mergeSuggestedInclusions(full)).toHaveLength(MAX_INCLUSIONS);
    // The merged suggestions pass validation as-is.
    expect(courseSchema.safeParse({ ...validCourse, inclusions: mergeSuggestedInclusions([]) }).success).toBe(true);
  });
});
