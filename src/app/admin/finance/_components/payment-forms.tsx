"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, CornerUpLeft, Trash2, XCircle } from "lucide-react";
import {
  deleteFeePlan,
  markPaymentFailed,
  markPaymentReceived,
  recordPayment,
  recordRefund,
  voidPayment,
  voidRefund,
  type FinanceActionResult,
} from "@/app/actions/finance";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MANUAL_METHODS, PAYMENT_METHOD_LABELS, paiseToInput } from "@/lib/finance/money";
import { Feedback } from "./reminder-buttons";

export type InstallmentOption = { id: string; label: string; remaining: number };

function MethodSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {MANUAL_METHODS.map((m) => (
        <option key={m} value={m}>
          {PAYMENT_METHOD_LABELS[m]}
        </option>
      ))}
    </Select>
  );
}

/** Record a manual payment. Amounts are re-validated and stored by the server. */
export function RecordPaymentForm({ feePlanId, installments, defaultAmount, today, currency }: { feePlanId: string; installments: InstallmentOption[]; defaultAmount: number; today: string; currency: string }) {
  const router = useRouter();
  const blank = { amount: defaultAmount > 0 ? paiseToInput(defaultAmount) : "", paidOn: today, method: "upi", reference: "", notes: "", installmentId: "", status: "completed" };
  const [v, setV] = useState(blank);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  const errors = result?.fieldErrors ?? {};
  const set = (k: keyof typeof blank, value: string) => setV((s) => ({ ...s, [k]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(undefined);
    start(async () => {
      const res = await recordPayment({ feePlanId, ...v });
      setResult(res);
      if (res.ok) {
        setV({ ...blank, amount: "" });
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="pay-amount" label={`Amount (${currency})`} required error={errors.amount?.[0]}>
          <Input id="pay-amount" inputMode="decimal" value={v.amount} onChange={(e) => set("amount", e.target.value)} aria-invalid={Boolean(errors.amount)} />
        </Field>
        <Field id="pay-date" label="Payment date" required error={errors.paidOn?.[0]}>
          <Input id="pay-date" type="date" value={v.paidOn} max={v.status === "completed" ? today : undefined} onChange={(e) => set("paidOn", e.target.value)} />
        </Field>
        <Field id="pay-method" label="Method" required error={errors.method?.[0]}>
          <MethodSelect id="pay-method" value={v.method} onChange={(m) => set("method", m)} />
        </Field>
        <Field id="pay-ref" label="Reference / UTR / cheque no." error={errors.reference?.[0]}>
          <Input id="pay-ref" value={v.reference} onChange={(e) => set("reference", e.target.value)} maxLength={120} />
        </Field>
        {installments.length ? (
          <Field id="pay-inst" label="Applies to" hint="Automatic = the earliest unpaid installment first.">
            <Select id="pay-inst" value={v.installmentId} onChange={(e) => set("installmentId", e.target.value)}>
              <option value="">Automatic</option>
              {installments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="pay-status" label="Status" hint={v.status === "pending" ? "Pending payments (e.g. an uncleared cheque) do not count until marked received." : undefined}>
          <Select id="pay-status" value={v.status} onChange={(e) => set("status", e.target.value)}>
            <option value="completed">Received</option>
            <option value="pending">Pending (not yet cleared)</option>
          </Select>
        </Field>
      </div>
      <Field id="pay-notes" label="Notes">
        <Textarea id="pay-notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} className="min-h-14" />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record payment"}
        </Button>
      </div>
      <Feedback result={result} />
    </form>
  );
}

function ReasonForm({ id, label, cta, onSubmit, onCancel, pending }: { id: string; label: string; cta: string; onSubmit: (reason: string) => void; onCancel: () => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-2 rounded-md border border-line bg-canvas/60 p-2">
      <Field id={id} label={label} required>
        <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={pending || reason.trim().length < 3} onClick={() => onSubmit(reason)}>
          {cta}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Actions for one payment: mark received/failed, refund, void. */
export function PaymentActions({ paymentId, status, refundable, today, paidOn, currency }: { paymentId: string; status: string; refundable: number; today: string; paidOn: string; currency: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "void" | "refund">("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  const [refund, setRefund] = useState({ amount: paiseToInput(refundable), refundedOn: today, method: "bank_transfer", reference: "", reason: "" });
  const errors = result?.fieldErrors ?? {};

  const run = (fn: () => Promise<FinanceActionResult>) => {
    setResult(undefined);
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        setMode("");
        router.refresh();
      }
    });
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {status === "pending" ? (
          <>
            <Button size="xs" variant="success" disabled={pending} onClick={() => run(() => markPaymentReceived(paymentId))}>
              <CheckCircle2 className="size-3.5" aria-hidden /> Mark received
            </Button>
            <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => markPaymentFailed(paymentId))}>
              <XCircle className="size-3.5" aria-hidden /> Mark failed
            </Button>
          </>
        ) : null}
        {status === "completed" && refundable > 0 ? (
          <Button size="xs" variant="secondary" disabled={pending} onClick={() => setMode(mode === "refund" ? "" : "refund")} aria-expanded={mode === "refund"}>
            <CornerUpLeft className="size-3.5" aria-hidden /> Refund
          </Button>
        ) : null}
        {status !== "voided" ? (
          <Button size="xs" variant="ghost" className="text-danger-700" disabled={pending} onClick={() => setMode(mode === "void" ? "" : "void")} aria-expanded={mode === "void"}>
            <Ban className="size-3.5" aria-hidden /> Void
          </Button>
        ) : null}
      </div>
      {mode === "void" ? (
        <ReasonForm id={`void-${paymentId}`} label="Why void this payment?" cta="Void payment" pending={pending} onCancel={() => setMode("")} onSubmit={(reason) => run(() => voidPayment({ id: paymentId, reason }))} />
      ) : null}
      {mode === "refund" ? (
        <div className="grid gap-2 rounded-md border border-line bg-canvas/60 p-2 sm:grid-cols-2">
          <Field id={`ref-amt-${paymentId}`} label={`Refund amount (${currency})`} required error={errors.amount?.[0]} hint={`Up to ${paiseToInput(refundable)}`}>
            <Input id={`ref-amt-${paymentId}`} inputMode="decimal" value={refund.amount} onChange={(e) => setRefund((s) => ({ ...s, amount: e.target.value }))} />
          </Field>
          <Field id={`ref-date-${paymentId}`} label="Refund date" required error={errors.refundedOn?.[0]}>
            <Input id={`ref-date-${paymentId}`} type="date" min={paidOn} max={today} value={refund.refundedOn} onChange={(e) => setRefund((s) => ({ ...s, refundedOn: e.target.value }))} />
          </Field>
          <Field id={`ref-method-${paymentId}`} label="Refunded by">
            <MethodSelect id={`ref-method-${paymentId}`} value={refund.method} onChange={(m) => setRefund((s) => ({ ...s, method: m }))} />
          </Field>
          <Field id={`ref-ref-${paymentId}`} label="Reference">
            <Input id={`ref-ref-${paymentId}`} value={refund.reference} onChange={(e) => setRefund((s) => ({ ...s, reference: e.target.value }))} maxLength={120} />
          </Field>
          <Field id={`ref-reason-${paymentId}`} label="Reason" required error={errors.reason?.[0]} className="sm:col-span-2">
            <Input id={`ref-reason-${paymentId}`} value={refund.reason} onChange={(e) => setRefund((s) => ({ ...s, reason: e.target.value }))} maxLength={500} placeholder="e.g. Withdrew before the batch started" />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => recordRefund({ paymentId, ...refund }))}>
              Record refund
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <Feedback result={result} />
    </div>
  );
}

export function VoidRefundButton({ refundId }: { refundId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  return (
    <div className="grid gap-1">
      {open ? (
        <ReasonForm
          id={`void-ref-${refundId}`}
          label="Why void this refund?"
          cta="Void refund"
          pending={pending}
          onCancel={() => setOpen(false)}
          onSubmit={(reason) =>
            start(async () => {
              const res = await voidRefund({ id: refundId, reason });
              setResult(res);
              if (res.ok) {
                setOpen(false);
                router.refresh();
              }
            })
          }
        />
      ) : (
        <Button size="xs" variant="ghost" className="text-danger-700" onClick={() => setOpen(true)}>
          Void refund
        </Button>
      )}
      <Feedback result={result} />
    </div>
  );
}

export function DeleteFeePlanButton({ planId }: { planId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  return (
    <div className="grid gap-2">
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Remove this fee plan?</span>
          <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteFeePlan(planId);
                setResult(res);
                setConfirm(false);
                if (res.ok) router.refresh();
              })
            }
          >
            Remove
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="justify-self-start text-danger-700" onClick={() => setConfirm(true)}>
          <Trash2 className="size-4" aria-hidden /> Remove fee plan
        </Button>
      )}
      <Feedback result={result} />
    </div>
  );
}
