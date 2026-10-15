import { z } from "zod";

export type FieldType = "text" | "email" | "phone" | "number" | "select" | "multiselect" | "radio" | "checkbox" | "date" | "textarea" | "consent";

export type RegistrationField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  help_text?: string | null;
  placeholder?: string | null;
};

/** Standard fields stored on the candidate record; everything else is kept as an answer. */
export const STANDARD_KEYS = [
  "full_name",
  "email",
  "phone",
  "city",
  "country",
  "company",
  "job_title",
  "total_experience_years",
  "relevant_experience_years",
  "skills",
  "interests",
  "learning_objectives",
  "preferred_schedule",
  "preferred_delivery_mode",
  "employment_status",
  "heard_about",
  "marketing_consent",
  "privacy_consent",
] as const;

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "radio", label: "Radio buttons" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "textarea", label: "Paragraph text" },
  { value: "consent", label: "Consent checkbox" },
];

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

function fieldSchema(f: RegistrationField): z.ZodType {
  const req = f.required;
  const optStr = (s: z.ZodString) => (req ? s : s.optional().or(z.literal("")));
  switch (f.type) {
    case "email":
      return req
        ? z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"))
        : z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).optional().or(z.literal(""));
    case "phone":
      return optStr(z.string().trim().regex(PHONE_RE, "Enter a phone number with country code, e.g. +91 98765 43210"));
    case "number":
      return req
        ? z.coerce.number({ message: "Enter a number" }).min(0, "Must be 0 or more").max(1_000_000)
        : z.union([z.literal(""), z.coerce.number({ message: "Enter a number" }).min(0).max(1_000_000)]).optional();
    case "date":
      return optStr(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"));
    case "select":
    case "radio": {
      const s = z.string().refine((v) => v === "" || f.options.includes(v), "Choose one of the options");
      return req ? s.refine((v) => v !== "", "This field is required") : s.optional();
    }
    case "multiselect": {
      const arr = z.array(z.string().refine((v) => f.options.includes(v), "Invalid option")).max(50);
      return req ? arr.min(1, "Choose at least one option") : arr.optional();
    }
    case "checkbox":
      return req ? z.literal(true, { message: "This box must be ticked" }) : z.boolean().optional();
    case "consent":
      return z.literal(true, { message: "Please accept to continue" });
    case "textarea":
      return optStr(z.string().trim().min(1, "This field is required").max(4000));
    default:
      return optStr(z.string().trim().min(1, "This field is required").max(300));
  }
}

/** Builds the server-side validator for a course's configured registration form. */
export function buildRegistrationSchema(fields: RegistrationField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) shape[f.key] = fieldSchema(f);
  return z.object(shape).strip();
}

/** Reads typed values for the configured fields out of FormData. */
export function readRegistrationForm(fields: RegistrationField[], fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "multiselect") out[f.key] = fd.getAll(f.key).map(String);
    else if (f.type === "checkbox" || f.type === "consent") out[f.key] = fd.get(f.key) === "on";
    else out[f.key] = String(fd.get(f.key) ?? "");
  }
  return out;
}

/** Splits validated data into candidate columns and custom answers. */
export function splitRegistration(fields: RegistrationField[], data: Record<string, unknown>) {
  const values: Record<string, unknown> = {};
  const answers: Record<string, unknown> = {};
  const standard = new Set<string>(STANDARD_KEYS);
  for (const f of fields) {
    const v = data[f.key];
    if (v === undefined || v === "") continue;
    if (standard.has(f.key)) values[f.key] = v;
    else answers[f.key] = { label: f.label, value: v };
  }
  return { values, answers };
}
