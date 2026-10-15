import { z } from "zod";
import { passwordSchema } from "@/lib/validation/auth";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), "Enter a full URL starting with https://");

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name").max(120),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address"),
  contactPhone: optionalText(32).refine(
    (v) => v === null || /^\+?[0-9 ()-]{6,32}$/.test(v),
    "Enter a phone number with country code, e.g. +91 98765 43210",
  ),
  websiteUrl: optionalUrl,
  logoUrl: optionalUrl,
  timezone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone"),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code, e.g. INR"),
  staffEnabled: z.boolean(),
  instructorsEnabled: z.boolean(),
});

export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>;

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(120),
});

export const credentialsSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    newPassword: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword === "") return;
    const result = passwordSchema.safeParse(v.newPassword);
    if (!result.success) ctx.addIssue({ code: "custom", path: ["newPassword"], message: result.error.issues[0]?.message ?? "Choose a stronger password" });
    if (v.newPassword !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match" });
  });

export type CredentialsInput = z.input<typeof credentialsSchema>;
