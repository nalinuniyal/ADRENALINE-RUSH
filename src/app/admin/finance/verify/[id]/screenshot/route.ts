import { z } from "zod";
import { getAccess } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/**
 * A payment screenshot a student uploaded. Only for finance viewers of the
 * organization: the row is first read with the caller's own client (RLS), and
 * only then are the bytes (not granted to app users) read with the secret key.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/finance/verify/[id]/screenshot">) {
  const { id } = await params;
  if (!z.guid().safeParse(id).success) return new Response("Not found", { status: 404, headers: PRIVATE });
  const access = await getAccess();
  if (access.status !== "ok" || !access.access.permissions.includes("finance.view")) return new Response("Not found", { status: 404, headers: PRIVATE });
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase.from("payment_submissions").select("id, has_screenshot").eq("id", id).eq("organization_id", access.access.organization.id).maybeSingle();
  if (!row?.has_screenshot) return new Response("Not found", { status: 404, headers: PRIVATE });
  const { data } = await createSupabaseAdminClient().from("payment_submissions").select("screenshot, screenshot_type").eq("id", id).maybeSingle();
  if (!data?.screenshot || !data.screenshot_type || typeof data.screenshot !== "string" || !data.screenshot.startsWith("\\x")) return new Response("Not found", { status: 404, headers: PRIVATE });
  const body = Buffer.from(data.screenshot.slice(2), "hex");
  return new Response(body, {
    headers: {
      ...PRIVATE,
      "Content-Type": data.screenshot_type,
      "Content-Length": String(body.byteLength),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
