import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { siteUrl } from "@/lib/email/automations";
import { razorpayStatus } from "@/lib/finance/razorpay";
import { CopyButton } from "../../resources/_components/copy-button";

/** Settings › Integrations row for Razorpay (configured from environment variables). */
export function PaymentGatewayRow() {
  const s = razorpayStatus();
  const webhookUrl = `${siteUrl()}/api/webhooks/razorpay`;
  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Payment gateway (Razorpay)</span>
        <span className="flex flex-wrap items-center gap-2">
          {s.configured ? (
            <>
              <Badge tone={s.mode === "live" ? "success" : "warning"}>{s.mode === "live" ? "Live mode" : "Test mode"}</Badge>
              {!s.webhookSecretSet ? <Badge tone="danger">Webhook secret missing</Badge> : null}
            </>
          ) : (
            <Badge>Not set up · manual payments only</Badge>
          )}
        </span>
      </div>
      {s.configured ? (
        <p className="text-xs text-muted">
          Key id <code className="rounded bg-canvas px-1">{s.keyId}</code>.{" "}
          {s.mode === "test" ? "Test mode: links work with Razorpay’s test UPI and cards; no real money moves." : "Live mode: real payments."} Create links from a student’s page under{" "}
          <Link href="/admin/finance/fees" className="text-brand-700 hover:underline">
            Fees &amp; dues
          </Link>
          .
        </p>
      ) : (
        <p className="text-xs text-muted">
          Optional. Add RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET (see “Online payments with Razorpay” in the setup guide) to send pay-online links.
          {s.problem ? <span className="block text-warning-700">{s.problem}</span> : null}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Webhook URL for Razorpay:</span>
        <code className="rounded bg-canvas px-1 break-all">{webhookUrl}</code>
        <CopyButton text={webhookUrl} label="Copy" size="xs" />
      </div>
    </li>
  );
}
