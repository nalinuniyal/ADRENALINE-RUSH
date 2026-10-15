import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { CheckCircle2, Clock, LinkIcon, ShieldCheck } from "lucide-react";
import { PaymentDetailsPanel } from "@/components/public/payment-details";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { todayIn } from "@/lib/calendar";
import { formatPaise, paiseToInput } from "@/lib/finance/money";
import { hashPayToken, isWellFormedPayToken } from "@/lib/finance/pay-link-token";
import { isOpenPayPage, parsePayPage, type PayPage } from "@/lib/finance/pay-page";
import { upiNote } from "@/lib/finance/upi";
import { formatDate } from "@/lib/format";
import { checkRateLimit, clientIp, type RateLimitRule } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PayProofForm } from "./proof-form";

// Private, per-student page: never indexed, never cached by shared caches.
export const metadata: Metadata = { title: "Pay your fee", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

const VIEW_PER_IP: RateLimitRule = { namespace: "pay-view-ip", limit: 60, windowSeconds: 15 * 60 };

export default function PayPageRoute({ params }: PageProps<"/pay/[token]">) {
  return (
    <section className="bg-canvas">
      <div className="bg-gradient-to-b from-ink-950 to-ink-900 pt-24 pb-16 text-white sm:pt-28">
        <div className="mx-auto max-w-3xl px-4">
          <p className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-volt-400 uppercase">
            <ShieldCheck className="size-4" aria-hidden /> Fee payment
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Pay your fee</h1>
        </div>
      </div>
      <div className="mx-auto -mt-10 max-w-3xl px-4 pb-16">
        <Suspense fallback={<div className="ar-skeleton h-96 rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
          <PayContent params={params} />
        </Suspense>
      </div>
    </section>
  );
}

async function load(token: string): Promise<PayPage | "limited"> {
  if (!isWellFormedPayToken(token)) return { status: "not_found", businessName: null };
  const rate = await checkRateLimit(VIEW_PER_IP, await clientIp());
  if (rate === "limited") return "limited";
  const { data, error } = await createSupabaseAdminClient().rpc("get_fee_pay_page", { p_token_hash: hashPayToken(token) });
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "pay page read failed", code: error.code }));
    return { status: "error", businessName: null };
  }
  return parsePayPage(data);
}

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-8 text-center shadow-card">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-50">{icon}</div>
      <h2 className="mt-4 text-xl font-bold">{title}</h2>
      <div className="mt-2 text-sm text-muted">{children}</div>
      <Link href="/" className={buttonVariants({ variant: "secondary", className: "mt-6" })}>
        Go to the website
      </Link>
    </div>
  );
}

async function PayContent({ params }: { params: PageProps<"/pay/[token]">["params"] }) {
  const { token } = await params;
  const page = await load(token);
  if (page === "limited") {
    return <Notice icon={<Clock className="size-7 text-brand-600" aria-hidden />} title="Please wait a moment">Too many requests from your connection. Try again in 15 minutes.</Notice>;
  }
  if (page.status === "not_found" || page.status === "revoked") {
    return (
      <Notice icon={<LinkIcon className="size-7 text-brand-600" aria-hidden />} title="This payment link is not valid">
        It may have been replaced with a new one. Please ask {page.businessName ?? "us"} for the latest link.
      </Notice>
    );
  }
  if (page.status === "closed") {
    return <Notice icon={<LinkIcon className="size-7 text-brand-600" aria-hidden />} title="Payments are closed">This enrollment is no longer active. Please contact {page.businessName ?? "us"}.</Notice>;
  }
  if (page.status === "error") {
    return <Notice icon={<Clock className="size-7 text-brand-600" aria-hidden />} title="Something went wrong">We could not load this page. Please try again in a minute.</Notice>;
  }
  if (!isOpenPayPage(page)) {
    return <Notice icon={<Clock className="size-7 text-brand-600" aria-hidden />} title="Something went wrong">We could not load this page. Please try again in a minute.</Notice>;
  }
  if (page.status === "paid") {
    return (
      <Notice icon={<CheckCircle2 className="size-7 text-success-700" aria-hidden />} title="Nothing to pay">
        Your fee for {page.courseTitle} is fully paid. Thank you{page.firstName ? `, ${page.firstName}` : ""}!
      </Notice>
    );
  }

  const note = upiNote(page.courseTitle, page.reference);
  const hasDetails = page.detailsShown && (page.upiVpa || page.bank);
  const today = todayIn("Asia/Kolkata");
  return (
    <div className="grid gap-4">
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card">
        <p className="text-sm text-muted">{page.businessName}</p>
        <p className="mt-1 text-lg font-semibold">
          Hi {page.firstName ?? "there"}, here is how to pay for {page.courseTitle}.
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted uppercase">{page.installmentLabel ? `${page.installmentLabel}${page.dueDate ? ` · due ${formatDate(page.dueDate)}` : ""}` : "Amount due"}</p>
            <p className="text-3xl font-bold tabular-nums" data-testid="pay-amount">
              {formatPaise(page.amountDue, page.currency)}
            </p>
          </div>
          {page.outstanding > page.amountDue ? <p className="text-sm text-muted">Total still payable: {formatPaise(page.outstanding, page.currency)}</p> : null}
        </div>
        <p className="mt-3 text-xs text-muted">Reference: {page.reference}</p>
      </div>

      {page.pendingSubmissions > 0 ? (
        <Alert tone="info" title="We are checking your payment">
          {page.pendingSubmissions === 1 ? "One payment you reported is" : `${page.pendingSubmissions} payments you reported are`} waiting to be confirmed. You do not need to pay again for it.
        </Alert>
      ) : null}

      {hasDetails ? (
        <PaymentDetailsPanel details={page} amountPaise={page.amountDue} currency={page.currency} note={note} />
      ) : (
        <Alert tone="info" title="Payment details">
          {page.instructions ?? `Please contact ${page.businessName} for the payment details.`}
        </Alert>
      )}

      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card">
        <h2 className="text-base font-bold">Already paid? Tell us</h2>
        <p className="mt-1 text-sm text-muted">
          Enter the UTR / UPI reference number from your payment app or bank SMS. We check it against our account and send you a receipt. Your payment shows as confirmed only after that.
        </p>
        <PayProofForm token={token} defaultAmount={paiseToInput(page.amountDue)} today={today} defaultMethod={page.upiVpa ? "upi" : "bank_transfer"} />
      </div>
      <p className="text-center text-xs text-muted">This page is private to you. Please do not share it.</p>
    </div>
  );
}
