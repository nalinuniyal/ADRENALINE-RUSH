import { Building2, QrCode, Smartphone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatPaise } from "@/lib/finance/money";
import type { PaymentDetails } from "@/lib/finance/pay-page";
import { ACCOUNT_TYPE_LABELS, buildUpiLink, isValidVpa } from "@/lib/finance/upi";
import { qrDataUrl } from "@/lib/finance/upi-qr";
import { CopyText } from "./copy-text";

function Row({ label, value, copy }: { label: string; value: string | null; copy?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-sm font-semibold break-all text-fg">{value}</span>
        {copy ? <CopyText value={value} label={label} /> : null}
      </dd>
    </div>
  );
}

/**
 * UPI (auto-generated QR with the amount, "Pay with UPI app" deep link, UPI ID)
 * and bank transfer details. Used on the candidate pay page (with an amount)
 * and on course pages (without one). Server Component: the QR is drawn here.
 */
export async function PaymentDetailsPanel({
  details,
  amountPaise,
  currency = "INR",
  note,
}: {
  details: PaymentDetails;
  /** null: the payer types the amount. */
  amountPaise: number | null;
  currency?: string;
  note?: string | null;
}) {
  const vpa = details.upiVpa && isValidVpa(details.upiVpa) ? details.upiVpa : null;
  const upiLink = vpa && currency === "INR" ? buildUpiLink({ vpa, payeeName: details.upiPayeeName, amountPaise: amountPaise && amountPaise > 0 ? amountPaise : null, note }) : null;
  const qr = upiLink ? await qrDataUrl(upiLink) : null;
  const amountText = amountPaise ? formatPaise(amountPaise, currency) : null;
  const bank = details.bank;

  return (
    <div className="grid gap-4">
      {vpa ? (
        <section aria-labelledby="pay-upi" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
          <h2 id="pay-upi" className="flex items-center gap-2 text-base font-bold text-fg">
            <QrCode className="size-5 text-brand-600" aria-hidden /> Pay by UPI
          </h2>
          <p className="mt-1 text-sm text-muted">
            {amountText ? `Scan with any UPI app (Google Pay, PhonePe, Paytm, BHIM or your bank's app). The amount ${amountText} is filled in for you.` : "Scan with any UPI app (Google Pay, PhonePe, Paytm, BHIM or your bank's app) and enter the amount."}
          </p>
          <div className="mt-4 grid items-center gap-4 sm:grid-cols-[auto_1fr]">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated SVG data URL
              <img src={qr} alt={`UPI QR code to pay ${details.upiPayeeName ?? vpa}${amountText ? ` ${amountText}` : ""}`} width={220} height={220} className="mx-auto size-[220px] rounded-lg border border-line bg-white p-1" data-testid="upi-qr" />
            ) : null}
            <div className="grid min-w-0 gap-3">
              {upiLink ? (
                <a href={upiLink} className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })} data-testid="upi-app-link">
                  <Smartphone className="size-5" aria-hidden /> {amountText ? `Pay ${amountText} with UPI app` : "Pay with UPI app"}
                </a>
              ) : null}
              <p className="text-xs text-muted">The button opens your UPI app on a phone. On a computer, scan the QR code with your phone.</p>
              <dl className="divide-y divide-line rounded-lg border border-line px-3">
                <Row label="UPI ID" value={vpa} copy />
                <Row label="Name" value={details.upiPayeeName} />
                {amountText ? <Row label="Amount" value={amountText} /> : null}
                {note ? <Row label="Note / reference" value={note} copy /> : null}
              </dl>
            </div>
          </div>
          {details.upiQrMediaId ? (
            <details className="mt-4 rounded-lg border border-line px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-brand-700">Prefer our own QR code?</summary>
              <p className="mt-2 text-xs text-muted">
                This QR code does not include the amount{amountText ? `: type ${amountText} yourself` : ""}. Add {note ? `“${note}”` : "your name"} in the note so we can find your payment.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded media served by /media */}
              <img src={`/media/${details.upiQrMediaId}`} alt={`${details.upiPayeeName ?? "Business"} UPI QR code`} className="mx-auto mt-3 max-h-72 w-auto rounded-lg border border-line bg-white" loading="lazy" />
            </details>
          ) : null}
        </section>
      ) : null}

      {bank ? (
        <section aria-labelledby="pay-bank" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
          <h2 id="pay-bank" className="flex items-center gap-2 text-base font-bold text-fg">
            <Building2 className="size-5 text-brand-600" aria-hidden /> Bank transfer (NEFT / IMPS / RTGS)
          </h2>
          <dl className="mt-3 divide-y divide-line rounded-lg border border-line px-3">
            <Row label="Account holder" value={bank.accountHolder} copy />
            <Row label="Account number" value={bank.accountNumber} copy />
            <Row label="IFSC" value={bank.ifsc} copy />
            <Row label="Bank" value={bank.bankName} />
            <Row label="Branch" value={bank.branch} />
            <Row label="Account type" value={bank.accountType ? (ACCOUNT_TYPE_LABELS[bank.accountType] ?? bank.accountType) : null} />
            {amountText ? <Row label="Amount" value={amountText} /> : null}
            {note ? <Row label="Remarks / reference" value={note} copy /> : null}
          </dl>
        </section>
      ) : null}

      {details.instructions ? (
        <section aria-label="Payment instructions" className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm whitespace-pre-line shadow-card">
          {details.instructions}
        </section>
      ) : null}
    </div>
  );
}
