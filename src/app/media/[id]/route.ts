import { connection } from "next/server";
import { z } from "zod";
import { IMAGE_TYPES } from "@/lib/email/image";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const NOT_FOUND_HEADERS = { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" };

/**
 * Public image delivery for uploaded media (email clients must be able to load
 * them without signing in). Ids are random UUIDs; content never changes for an
 * id, so responses are cached for a year. Only image types that were verified
 * from their bytes at upload are served, with nosniff and a locked-down CSP.
 */
export async function GET(_request: Request, { params }: RouteContext<"/media/[id]">) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

  const { data, error } = await createSupabaseAdminClient().from("media_assets").select("content_type, data, sha256").eq("id", id).maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "media read failed", code: error.code }));
    return new Response("Temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!data || !(IMAGE_TYPES as readonly string[]).includes(data.content_type) || typeof data.data !== "string" || !data.data.startsWith("\\x")) {
    return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const body = Buffer.from(data.data.slice(2), "hex");
  return new Response(body, {
    headers: {
      "Content-Type": data.content_type,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${data.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  });
}
