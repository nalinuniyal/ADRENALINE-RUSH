import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { Aurora } from "@/components/fx/aurora";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Payment", robots: { index: false, follow: false } };

/**
 * Where Razorpay sends the payer after a payment link. It only shows a
 * message: payments are recorded from Razorpay's signed webhook, never from
 * this browser redirect.
 */
export default function PaymentThankYouPage({ searchParams }: PageProps<"/pay/thank-you">) {
  return (
    <section className="relative isolate flex min-h-[80vh] items-center overflow-hidden bg-gradient-to-b from-ink-950 to-ink-900 text-white">
      <Aurora />
      <div className="relative mx-auto max-w-xl px-4 py-32 text-center">
        <Suspense fallback={<h1 className="font-display text-3xl font-bold">Thank you!</h1>}>
          <Message searchParams={searchParams} />
        </Suspense>
        <Link href="/" className={buttonVariants({ variant: "inverse", className: "mt-8" })}>
          Back to the website
        </Link>
      </div>
    </section>
  );
}

async function Message({ searchParams }: { searchParams: PageProps<"/pay/thank-you">["searchParams"] }) {
  const status = (await searchParams).razorpay_payment_link_status;
  const paid = status === "paid";
  return (
    <>
      <div className="mx-auto flex size-20 animate-scale-in items-center justify-center rounded-full bg-success-500/15 ring-8 ring-success-500/10">
        {paid ? <CheckCircle2 className="size-10 text-success-500" aria-hidden /> : <Clock className="size-10 text-white/80" aria-hidden />}
      </div>
      <h1 className="mt-8 font-display text-3xl font-bold sm:text-4xl">{paid ? "Thank you for your payment!" : "Payment not completed"}</h1>
      <p className="mt-4 text-white/75">
        {paid
          ? "We will confirm it as soon as Razorpay notifies us, usually within a few minutes. Your receipt will follow."
          : "If money left your account, it will show up once Razorpay confirms it. Otherwise you can open the payment link again or contact us."}
      </p>
    </>
  );
}
