"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ImageIcon, XCircle } from "lucide-react";
import { approveSubmission, rejectSubmission, type UpiActionResult } from "@/app/actions/finance-upi";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { SubmissionView } from "@/lib/finance/pay-page";
import { cn } from "@/lib/utils";


/** "I've paid" reports with Approve / Reject for finance managers. */
export function SubmissionList({ items, canManage, compact, empty }: { items: SubmissionView[]; canManage: boolean; compact?: boolean; empty?: ReactNode }) {
  // Kept here: a decided report can leave the list on refresh, the message must stay.
  const [notice, setNotice] = useState<string>();
  return (
    <div className="grid gap-3">
      {notice ? (
        <Alert tone="success" className="mb-1">
          {notice}
        </Alert>
      ) : null}
      {items.length ? (
        <ul className="grid gap-3" data-testid="submission-list">
          {items.map((s) => (
            <SubmissionItem key={s.id} s={s} canManage={canManage} compact={compact} onDone={setNotice} />
          ))}
        </ul>
      ) : (
        empty
      )}
    </div>
  );
}

function SubmissionItem({ s, canManage, compact, onDone }: { s: SubmissionView; canManage: boolean; compact?: boolean; onDone: (message: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<UpiActionResult>();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [amount, setAmount] = useState(s.amountInput);
  const [reason, setReason] = useState(s.duplicateOf ? "Duplicate: this transaction is already recorded." : "");

  const approve = () =>
    start(async () => {
      const res = await approveSubmission({ id: s.id, amount: amount === s.amountInput ? "" : amount });
      setResult(res.ok ? undefined : res);
      if (res.ok) {
        setMode("idle");
        onDone(res.message ?? "Done.");
        router.refresh();
      }
    });
  const reject = () =>
    start(async () => {
      const res = await rejectSubmission({ id: s.id, reason });
      setResult(res.ok ? undefined : res);
      if (res.ok) {
        setMode("idle");
        onDone(res.message ?? "Done.");
        router.refresh();
      }
    });

  return (
    <li className={cn("rounded-lg border border-line p-3", s.status !== "pending" && "opacity-80")} data-testid="submission-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {!compact ? (
            <p className="font-semibold">
              {s.feeHref ? (
                <Link href={s.feeHref} className="text-brand-700 hover:underline">
                  {s.candidateName}
                </Link>
              ) : (
                s.candidateName
              )}
              <span className="font-normal text-muted"> · {s.courseTitle}</span>
            </p>
          ) : null}
          <p className="text-base font-semibold tabular-nums">{s.amountText}</p>
          <p className="text-xs text-muted">
            Paid {s.paidOnText} · {s.methodText} · UTR <span className="font-mono text-fg">{s.utr}</span>
          </p>
          <p className="text-xs text-muted">Reported {s.submittedText}</p>
          {s.note ? <p className="mt-1 text-xs whitespace-pre-line">“{s.note}”</p> : null}
          {s.rejectReason ? <p className="mt-1 text-xs text-danger-700">Rejected: {s.rejectReason}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s.status === "pending" ? <Badge tone="warning">To verify</Badge> : s.status === "approved" ? <Badge tone="success">Approved</Badge> : <Badge>Rejected</Badge>}
          {s.receiptHref ? (
            <Link href={s.receiptHref} className="text-xs font-medium text-brand-700 hover:underline">
              Receipt
            </Link>
          ) : null}
          {s.hasScreenshot ? (
            <a href={`/admin/finance/verify/${s.id}/screenshot`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <ImageIcon className="size-3.5" aria-hidden /> Screenshot
            </a>
          ) : null}
        </div>
      </div>
      {s.duplicateOf && s.status === "pending" ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning-700">
          <AlertTriangle className="size-3.5" aria-hidden /> A payment with this UTR is already recorded ({s.duplicateOf}). It is probably a duplicate.
        </p>
      ) : null}
      {canManage && s.status === "pending" ? (
        <div className="mt-2 grid gap-2 border-t border-line pt-2">
          <p className="text-xs text-muted">Check your bank or UPI app for this UTR and amount before approving.</p>
          {mode === "idle" ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="success" disabled={pending} onClick={() => setMode("approve")}>
                <CheckCircle2 className="size-4" aria-hidden /> Approve
              </Button>
              <Button size="sm" variant="secondary" className="text-danger-700" disabled={pending} onClick={() => setMode("reject")}>
                <XCircle className="size-4" aria-hidden /> Reject
              </Button>
            </div>
          ) : mode === "approve" ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field id={`amt-${s.id}`} label="Amount received" className="w-40">
                <Input id={`amt-${s.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Button size="sm" variant="success" disabled={pending} onClick={approve} aria-busy={pending}>
                Confirm and record payment
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Field id={`why-${s.id}`} label="Reason (kept in the history)" className="min-w-0 flex-1 basis-60">
                <Input id={`why-${s.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Not received in the bank account" />
              </Field>
              <Button size="sm" variant="danger" disabled={pending} onClick={reject} aria-busy={pending}>
                Reject
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ) : null}
      {result?.message ? (
        <Alert tone={result.ok ? "success" : "danger"} className="mt-2">
          {result.message}
        </Alert>
      ) : null}
    </li>
  );
}
