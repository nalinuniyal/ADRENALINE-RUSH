"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, MessageCircle, X } from "lucide-react";
import { cancelRazorpayLink, createRazorpayLink, type FinanceActionResult } from "@/app/actions/finance";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { whatsappChatLink } from "@/lib/public-site";
import { CopyButton } from "../../resources/_components/copy-button";
import { Feedback } from "./reminder-buttons";

export type LinkRow = { id: string; amountText: string; target: string; status: string; shortUrl: string | null; error: string | null; createdText: string };

const TONES: Record<string, BadgeTone> = { created: "brand", paid: "success", partially_paid: "warning", expired: "neutral", cancelled: "neutral", failed: "danger", creating: "warning" };
const LABELS: Record<string, string> = { created: "Waiting for payment", paid: "Paid", partially_paid: "Part paid", expired: "Expired", cancelled: "Cancelled", failed: "Failed", creating: "Not created" };

/** Create, share and cancel Razorpay payment links for one fee plan. */
export function PaymentLinks({
  feePlanId,
  nextInstallment,
  outstandingText,
  links,
  phone,
  countryCode,
  candidateName,
}: {
  feePlanId: string;
  nextInstallment: { id: string; text: string } | null;
  outstandingText: string | null;
  links: LinkRow[];
  phone: string | null;
  countryCode: string;
  candidateName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();

  const create = (installmentId: string | null) => {
    setResult(undefined);
    start(async () => {
      const res = await createRazorpayLink({ feePlanId, installmentId });
      setResult(res);
      router.refresh();
    });
  };
  const cancel = (id: string) => {
    setResult(undefined);
    start(async () => {
      const res = await cancelRazorpayLink(id);
      setResult(res);
      router.refresh();
    });
  };

  const first = candidateName.trim().split(/\s+/)[0] || "there";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {nextInstallment ? (
          <Button size="sm" disabled={pending} onClick={() => create(nextInstallment.id)}>
            <Link2 className="size-4" aria-hidden /> Link for {nextInstallment.text}
          </Button>
        ) : null}
        {outstandingText ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => create(null)}>
            <Link2 className="size-4" aria-hidden /> Link for full balance ({outstandingText})
          </Button>
        ) : null}
      </div>
      <Feedback result={result} />
      {links.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {links.map((l) => {
            const wa = l.shortUrl ? whatsappChatLink(phone, `Hi ${first}, here is your secure payment link for ${l.target} (${l.amountText}): ${l.shortUrl}`, countryCode) : null;
            return (
              <li key={l.id} className="grid gap-2 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold tabular-nums">{l.amountText}</span> · {l.target}
                    <p className="text-xs text-muted">{l.createdText}</p>
                  </div>
                  <Badge tone={TONES[l.status] ?? "neutral"}>{LABELS[l.status] ?? l.status}</Badge>
                </div>
                {l.shortUrl && l.status === "created" ? (
                  <div className="flex flex-wrap items-start gap-1.5">
                    <a href={l.shortUrl} target="_blank" rel="noopener noreferrer" className="self-center text-xs break-all text-brand-700 hover:underline">
                      {l.shortUrl}
                    </a>
                    <CopyButton text={l.shortUrl} label="Copy link" size="xs" />
                    {wa?.ok ? (
                      <a href={wa.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong px-2.5 text-xs font-medium text-brand-600 hover:bg-brand-50">
                        <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
                      </a>
                    ) : null}
                    <Button size="xs" variant="ghost" className="text-danger-700" disabled={pending} onClick={() => cancel(l.id)}>
                      <X className="size-3.5" aria-hidden /> Cancel link
                    </Button>
                  </div>
                ) : null}
                {l.error ? <p className="text-xs text-danger-700">{l.error}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
