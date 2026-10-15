import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Supabase client bound to the signed-in user's session cookie.
 * Every query runs as that user, so Row Level Security applies.
 */
export async function createSupabaseServerClient() {
  // Session data is per request: keep it out of prerendered/prefetched shells
  // (supabase-js compares token expiry with Date.now(), which prerendering forbids).
  await connection();
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session cookie on every request instead.
        }
      },
    },
  });
}
