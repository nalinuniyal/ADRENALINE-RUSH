import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(1, "Enter your password").max(200),
  next: z.string().max(500).optional(),
});

export const PASSWORD_RULES = "At least 12 characters, with upper- and lower-case letters and a number.";

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[a-z]/, "Include a lower-case letter")
  .regex(/[A-Z]/, "Include an upper-case letter")
  .regex(/[0-9]/, "Include a number");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Use at least 2 characters")
  .max(60, "Use at most 60 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lower-case letters, numbers and single hyphens");

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const setupSchema = z
  .object({
    setupToken: z.string().default(""),
    businessName: z.string().trim().min(2, "Enter your business name").max(120),
    businessSlug: slugSchema,
    fullName: z.string().trim().min(2, "Enter your name").max(120),
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type SetupInput = z.infer<typeof setupSchema>;
