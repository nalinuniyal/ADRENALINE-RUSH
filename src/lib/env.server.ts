import "server-only";
import { z } from "zod";

/**
 * Server-only secrets. Importing this file from a Client Component fails the
 * build (server-only), so these values can never reach browser code.
 */
const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20, "SUPABASE_SECRET_KEY must be the secret (or legacy service_role) key"),
  ADMIN_SETUP_TOKEN: z
    .string()
    .min(32, "ADMIN_SETUP_TOKEN must be at least 32 characters (generate with: openssl rand -hex 32)")
    .optional(),
  RATE_LIMIT_SALT: z.string().min(16, "RATE_LIMIT_SALT must be at least 16 characters").optional(),
});

/**
 * How the one-time /setup page is protected:
 *  - "token": ADMIN_SETUP_TOKEN is set; the form asks for it.
 *  - "local": no token, but running `npm run dev` on your own computer; the
 *    form works without a token so first-time setup needs no extra variables.
 *  - "secret-key": a deployed site without a token; the form asks for the
 *    Supabase secret key as proof of ownership (whoever has it already
 *    controls the database), so no extra variable is needed on Vercel.
 * In every mode the database refuses setup once a business exists.
 */
export type SetupMode = "token" | "local" | "secret-key";

export function setupMode(): SetupMode {
  const token = process.env.ADMIN_SETUP_TOKEN;
  if (token && token.length >= 32) return "token";
  return process.env.NODE_ENV === "development" ? "local" : "secret-key";
}

export type ServerEnv = z.infer<typeof serverSchema>;

export function serverEnv(): ServerEnv {
  const parsed = serverSchema.safeParse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ADMIN_SETUP_TOKEN: process.env.ADMIN_SETUP_TOKEN || undefined,
    RATE_LIMIT_SALT: process.env.RATE_LIMIT_SALT || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Invalid server environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
