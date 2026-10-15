import "server-only";
import { connection } from "next/server";
import { parsePaymentDetails, type PaymentDetails } from "@/lib/finance/pay-page";
import { createSupabasePublicClient } from "@/lib/supabase/public";

/**
 * UPI / bank details for public course pages, only when the owner switched
 * "show on public course pages" on. Never throws (the page renders without).
 */
export async function getPublicPaymentDetails(): Promise<PaymentDetails | null> {
  // Read per request (like getPublicSite), never during a prerender.
  await connection();
  const { data, error } = await createSupabasePublicClient().rpc("get_public_payment_details");
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "public payment details read failed", code: error.code || error.message?.slice(0, 80) }));
    return null;
  }
  return parsePaymentDetails(data);
}
