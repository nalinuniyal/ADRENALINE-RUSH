"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Mail, MessageCircle, RefreshCw, X } from "lucide-react";
import { createPayLink, ensurePayLink, revokePayLink, sendPayLink, type UpiActionResult } from "@/app/actions/finance-upi";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { CopyButton } from "../../resources/_components/copy-button";
import { openAfter } from "./reminder-buttons";

export type PayLinkView = { id: string; url: string; amountMode: "next_installment" | "balance"; openText: string };

function Feedback({ result }: { result?: UpiActionResult }) {
  if (!result?.message) return null;
  return <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert>;
}

/** The student's free UPI / bank-transfer pay page: make, copy, send, switch off. */
export function PayLinkCard({
  feePlanId,
  link,
  hasPhone,
  hasEmail,
  nextText,
  balanceText,
}: {
  feePlanId: string;
  link: PayLinkView | null;
  hasPhone: boolean;
  hasEmail: boolean;
  /** "Installment 2 (₹5,000)" or null when there are no installments left. */
  nextText: string | null;
  balanceText: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<UpiActionResult>();
  const [mode, setMode] = useState<"next_installment" | "balance">(link?.amountMode ?? (nextText ? "next_installment" : "balance"));

  const run = (fn: () => Promise<UpiActionResult>, open = false) => {
    setResult(undefined);
    start(async () => {
      const res = open ? await openAfter(fn) : await fn();
      setResult(res);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-3">
      {link ? (
        <div className="grid gap-2 rounded-lg border border-line p-3">
          <p className="text-xs text-muted">
            Asks for {link.amountMode === "balance" ? "the full balance" : "the next installment"} · {link.openText}
          </p>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs break-all text-brand-700 hover:underline" data-testid="pay-link-url">
            {link.url}
          </a>
          <div className="flex flex-wrap gap-1.5">
            <CopyButton text={link.url} label="Copy pay link" size="xs" />
            <Button size="xs" variant="secondary" disabled={pending || !hasPhone} title={hasPhone ? undefined : "No phone number saved"} onClick={() => run(() => sendPayLink({ feePlanId, channel: "whatsapp", create: false }), true)}>
              <MessageCircle className="size-3.5" aria-hidden /> Send by WhatsApp
            </Button>
            <Button size="xs" variant="secondary" disabled={pending || !hasEmail} title={hasEmail ? undefined : "No email saved"} onClick={() => run(() => sendPayLink({ feePlanId, channel: "email", create: false }))}>
              <Mail className="size-3.5" aria-hidden /> Email
            </Button>
            <Button size="xs" variant="ghost" className="text-danger-700" disabled={pending} onClick={() => run(() => revokePayLink(link.id))}>
              <X className="size-3.5" aria-hidden /> Switch off
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`pl-mode-${feePlanId}`} className="sr-only">
          Amount the link asks for
        </label>
        <Select id={`pl-mode-${feePlanId}`} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-auto max-w-full">
          {nextText ? <option value="next_installment">Next installment: {nextText}</option> : null}
          <option value="balance">Full balance: {balanceText}</option>
        </Select>
        <Button size="sm" variant={link ? "secondary" : "primary"} disabled={pending} onClick={() => run(() => createPayLink({ feePlanId, mode }))}>
          {link ? <RefreshCw className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />} {link ? "Make a new link" : "Make pay link"}
        </Button>
      </div>
      {link ? <p className="text-xs text-muted">A new link replaces the current one; the old link stops working.</p> : null}
      <Feedback result={result} />
    </div>
  );
}

/** Compact pay-link buttons for the overdue list. */
export function PayLinkQuick({ feePlanId, url, hasPhone }: { feePlanId: string; url: string | null; hasPhone: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [made, setMade] = useState<string | null>(url);
  const [result, setResult] = useState<UpiActionResult>();
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap gap-1.5">
        {made ? (
          <CopyButton text={made} label="Copy pay link" size="xs" />
        ) : (
          <Button
            size="xs"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await ensurePayLink(feePlanId);
                setResult(res.ok ? undefined : res);
                if (res.ok && res.url) setMade(res.url);
              })
            }
          >
            <Link2 className="size-3.5" aria-hidden /> Pay link
          </Button>
        )}
        <Button
          size="xs"
          variant="secondary"
          disabled={pending || !hasPhone}
          title={hasPhone ? undefined : "No phone number saved"}
          onClick={() =>
            start(async () => {
              const res = await openAfter(() => sendPayLink({ feePlanId, channel: "whatsapp", create: true }));
              setResult(res);
              router.refresh();
            })
          }
        >
          <MessageCircle className="size-3.5" aria-hidden /> WhatsApp pay link
        </Button>
      </div>
      {result?.message ? <p className={result.ok ? "max-w-sm text-xs text-success-700" : "max-w-sm text-xs text-danger-700"}>{result.message}</p> : null}
    </div>
  );
}
