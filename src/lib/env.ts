import { z } from "zod";
import { normalizeSupabaseUrl } from "./supabase-url.mjs";

/**
 * Public configuration. Safe for the browser: these values are inlined into
 * client bundles at build time, so NEVER add a secret here.
 * Each variable is referenced literally so Next.js can inline it.
 */
const publicSchema = z.object({
  // Tolerates a trailing slash, /rest/v1 and similar paste mistakes (see supabase-url.mjs).
  NEXT_PUBLIC_SUPABASE_URL: z.string().transform((value, ctx) => {
    const result = normalizeSupabaseUrl(value);
    if (result.ok) return result.url;
    ctx.addIssue({
      code: "custom",
      message: `NEXT_PUBLIC_SUPABASE_URL must be your Supabase project URL, like https://<project-ref>.supabase.co (${result.reason})`,
    });
    return z.NEVER;
  }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the publishable (or legacy anon) key"),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

let cached: PublicEnv | undefined;

export function publicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Invalid public environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}
