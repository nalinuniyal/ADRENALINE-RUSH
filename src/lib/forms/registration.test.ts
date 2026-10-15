import { describe, expect, it } from "vitest";
import { buildRegistrationSchema, readRegistrationForm, splitRegistration, type RegistrationField } from "./registration";

const fields: RegistrationField[] = [
  { key: "full_name", label: "Name", type: "text", required: true, options: [] },
  { key: "email", label: "Email", type: "email", required: true, options: [] },
  { key: "phone", label: "Phone", type: "phone", required: false, options: [] },
  { key: "total_experience_years", label: "Exp", type: "number", required: false, options: [] },
  { key: "preferred_schedule", label: "Schedule", type: "select", required: true, options: ["Weekdays", "Weekends"] },
  { key: "topics", label: "Topics", type: "multiselect", required: false, options: ["A", "B"] },
  { key: "privacy_consent", label: "Privacy", type: "consent", required: true, options: [] },
  { key: "portfolio", label: "Portfolio", type: "text", required: false, options: [] },
];

function fd(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("dynamic registration validation", () => {
  const schema = buildRegistrationSchema(fields);

  it("accepts a valid submission and splits standard vs custom answers", () => {
    const raw = readRegistrationForm(
      fields,
      fd([
        ["full_name", " Asha "],
        ["email", "ASHA@EXAMPLE.TEST"],
        ["phone", "+91 98765 43210"],
        ["total_experience_years", "4.5"],
        ["preferred_schedule", "Weekends"],
        ["topics", "A"],
        ["topics", "B"],
        ["privacy_consent", "on"],
        ["portfolio", "https://example.test"],
      ]),
    );
    const parsed = schema.parse(raw);
    const { values, answers } = splitRegistration(fields, parsed);
    expect(values).toMatchObject({ full_name: "Asha", email: "asha@example.test", total_experience_years: 4.5, privacy_consent: true });
    expect(answers).toEqual({ topics: { label: "Topics", value: ["A", "B"] }, portfolio: { label: "Portfolio", value: "https://example.test" } });
  });

  it("rejects missing required fields, bad options and missing consent", () => {
    const r = schema.safeParse(readRegistrationForm(fields, fd([["email", "bad"], ["preferred_schedule", "Mornings"], ["topics", "Z"]])));
    expect(r.success).toBe(false);
    const keys = Object.keys(r.error!.flatten().fieldErrors);
    expect(keys).toEqual(expect.arrayContaining(["full_name", "email", "preferred_schedule", "topics", "privacy_consent"]));
  });

  it("ignores fields that are not configured", () => {
    const parsed = schema.parse({ ...readRegistrationForm(fields, fd([["full_name", "A"], ["email", "a@b.test"], ["preferred_schedule", "Weekdays"], ["privacy_consent", "on"]])), is_admin: true });
    expect(parsed).not.toHaveProperty("is_admin");
  });
});
