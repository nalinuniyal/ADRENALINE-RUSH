"use client";

import { useState, useTransition, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { submitPaymentProof, type PayProofResult } from "@/app/actions/pay";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";

/** "I've paid" form: creates a pending report for the owner to verify. */
export function PayProofForm({ token, defaultAmount, today, defaultMethod }: { token: string; defaultAmount: string; today: string; defaultMethod: "upi" | "bank_transfer" }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<PayProofResult>();

  if (result?.ok) {
    return (
      <div className="mt-4 flex gap-3 rounded-lg border border-success-700/25 bg-success-50 p-4 text-sm text-success-700" role="status" data-testid="proof-sent">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>{result.message}</p>
      </div>
    );
  }

  const err = (k: string) => result?.fieldErrors?.[k]?.[0];
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setResult(undefined);
    start(async () => setResult(await submitPaymentProof(token, fd)));
  };

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4" aria-label="Report your payment">
      <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
        {result?.message ? (
          <Alert tone="danger" className="sm:col-span-2">
            {result.message}
          </Alert>
        ) : null}
        <Field id="utr" label="UTR / transaction reference" required error={err("utr")} hint="12 digits for UPI (called UPI Ref No. or UTR); longer for bank transfers." className="sm:col-span-2">
          <Input id="utr" name="utr" autoComplete="off" inputMode="text" maxLength={40} required aria-invalid={Boolean(err("utr"))} aria-describedby={describedBy("utr", err("utr"), true)} />
        </Field>
        <Field id="amount" label="Amount paid (₹)" required error={err("amount")}>
          <Input id="amount" name="amount" inputMode="decimal" defaultValue={defaultAmount} required aria-invalid={Boolean(err("amount"))} aria-describedby={describedBy("amount", err("amount"))} />
        </Field>
        <Field id="paidOn" label="Date paid" required error={err("paidOn")}>
          <Input id="paidOn" name="paidOn" type="date" defaultValue={today} max={today} required aria-invalid={Boolean(err("paidOn"))} aria-describedby={describedBy("paidOn", err("paidOn"))} />
        </Field>
        <Field id="method" label="Paid by" required error={err("method")}>
          <Select id="method" name="method" defaultValue={defaultMethod}>
            <option value="upi">UPI</option>
            <option value="bank_transfer">Bank transfer (NEFT / IMPS / RTGS)</option>
          </Select>
        </Field>
        <Field id="screenshot" label="Screenshot (optional)" error={err("screenshot")} hint="PNG, JPG or WebP, up to 2 MB.">
          <Input id="screenshot" name="screenshot" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby={describedBy("screenshot", err("screenshot"), true)} />
        </Field>
        <Field id="note" label="Note (optional)" error={err("note")} className="sm:col-span-2">
          <Textarea id="note" name="note" rows={2} maxLength={500} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" size="lg" disabled={pending} aria-busy={pending} className="w-full sm:w-auto">
            {pending ? "Sending…" : "I’ve paid: send details"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
