"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Plus, Trash2 } from "lucide-react";
import { saveFeePlan, type FinanceActionResult } from "@/app/actions/finance";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { computeFee, formatPaise, monthlyDueDates, paiseToInput, parseAmount, splitEvenly, type DiscountType } from "@/lib/finance/money";
import { Feedback } from "./reminder-buttons";

export type InstallmentDraft = { dueDate: string; amount: string; label: string };
export type FeePlanFormValues = {
  baseFee: string;
  currency: string;
  discountType: DiscountType;
  discountValue: string;
  discountReason: string;
  notes: string;
  installments: InstallmentDraft[];
};

/** Live preview of the fee maths; the server recomputes everything on save. */
function preview(v: FeePlanFormValues): { finalPaise: number | null; discountPaise: number; error: string | null } {
  const base = parseAmount(v.baseFee);
  if (base === null) return { finalPaise: null, discountPaise: 0, error: null };
  if (v.discountType === "none") return { finalPaise: base, discountPaise: 0, error: null };
  try {
    const value = v.discountType === "percent" ? v.discountValue.trim() || "0" : (parseAmount(v.discountValue) ?? 0);
    if (v.discountType === "percent" && (parseAmount(String(value)) ?? 0) > 10_000) return { finalPaise: null, discountPaise: 0, error: "A percentage cannot be more than 100" };
    const r = computeFee(base, v.discountType, value);
    return { finalPaise: r.finalPaise, discountPaise: r.discountPaise, error: null };
  } catch (e) {
    return { finalPaise: null, discountPaise: 0, error: e instanceof Error ? e.message : "Check the discount" };
  }
}

export function FeePlanForm({ enrollmentId, initial, today, priceHint, hasPayments }: { enrollmentId: string; initial: FeePlanFormValues; today: string; priceHint: string | null; hasPayments: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<FeePlanFormValues>(initial);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  const [split, setSplit] = useState({ count: String(Math.max(initial.installments.length, 3)), first: initial.installments[0]?.dueDate || today, every: "1" });
  const errors = result?.fieldErrors ?? {};
  const set = <K extends keyof FeePlanFormValues>(k: K, value: FeePlanFormValues[K]) => setV((s) => ({ ...s, [k]: value }));

  const p = useMemo(() => preview(v), [v]);
  const scheduleSum = v.installments.reduce((s, i) => s + (parseAmount(i.amount) ?? 0), 0);
  const scheduleOk = v.installments.length === 0 || (p.finalPaise !== null && scheduleSum === p.finalPaise);

  const setInstallment = (idx: number, patch: Partial<InstallmentDraft>) => setV((s) => ({ ...s, installments: s.installments.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));

  const applySplit = () => {
    const n = Math.min(Math.max(Number(split.count) || 1, 1), 60);
    if (p.finalPaise === null) return;
    const amounts = splitEvenly(p.finalPaise, n);
    const dates = monthlyDueDates(split.first || today, n, Math.min(Math.max(Number(split.every) || 1, 1), 12));
    set(
      "installments",
      amounts.map((a, i) => ({ dueDate: dates[i], amount: paiseToInput(a), label: v.installments[i]?.label ?? "" })),
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(undefined);
    start(async () => {
      const res = await saveFeePlan({
        enrollmentId,
        ...v,
        installments: v.installments.map((i) => ({ dueDate: i.dueDate, amount: i.amount, label: i.label })),
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field id="fee-base" label="Agreed course fee" required error={errors.baseFee?.[0]} hint={priceHint ?? undefined}>
          <Input id="fee-base" inputMode="decimal" value={v.baseFee} onChange={(e) => set("baseFee", e.target.value)} placeholder="e.g. 30000" aria-invalid={Boolean(errors.baseFee)} />
        </Field>
        <Field id="fee-currency" label="Currency" error={errors.currency?.[0]} hint={hasPayments ? "Fixed once payments exist" : undefined}>
          <Input id="fee-currency" value={v.currency} onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))} className="w-24 uppercase" disabled={hasPayments} maxLength={3} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="fee-dtype" label="Discount">
          <Select id="fee-dtype" value={v.discountType} onChange={(e) => set("discountType", e.target.value as DiscountType)}>
            <option value="none">No discount</option>
            <option value="amount">Fixed amount</option>
            <option value="percent">Percentage</option>
          </Select>
        </Field>
        {v.discountType !== "none" ? (
          <>
            <Field id="fee-dvalue" label={v.discountType === "percent" ? "Discount %" : "Discount amount"} required error={errors.discountValue?.[0] ?? p.error ?? undefined}>
              <Input id="fee-dvalue" inputMode="decimal" value={v.discountValue} onChange={(e) => set("discountValue", e.target.value)} aria-invalid={Boolean(errors.discountValue || p.error)} />
            </Field>
            <Field id="fee-dreason" label="Reason for discount" required error={errors.discountReason?.[0]}>
              <Input id="fee-dreason" value={v.discountReason} onChange={(e) => set("discountReason", e.target.value)} maxLength={300} placeholder="e.g. Early-bird offer" aria-invalid={Boolean(errors.discountReason)} />
            </Field>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-sm" aria-live="polite">
        Final fee:{" "}
        <strong className="tabular-nums" data-testid="final-fee">
          {p.finalPaise === null ? "—" : formatPaise(p.finalPaise, v.currency || "INR")}
        </strong>
        {p.discountPaise ? <span className="text-muted"> (discount {formatPaise(p.discountPaise, v.currency || "INR")})</span> : null}
      </div>

      <fieldset className="grid gap-3 rounded-lg border border-line p-3">
        <legend className="px-1 text-sm font-semibold">Installments (optional)</legend>
        <p className="text-xs text-muted">Leave empty for a single payment. With installments, they must add up exactly to the final fee.</p>
        <div className="grid gap-2 rounded-md bg-canvas/60 p-2 sm:grid-cols-[auto_auto_auto_auto] sm:items-end">
          <Field id="split-n" label="Split into">
            <Input id="split-n" type="number" min={1} max={60} value={split.count} onChange={(e) => setSplit((s) => ({ ...s, count: e.target.value }))} className="w-20" />
          </Field>
          <Field id="split-first" label="First due">
            <Input id="split-first" type="date" value={split.first} onChange={(e) => setSplit((s) => ({ ...s, first: e.target.value }))} />
          </Field>
          <Field id="split-every" label="Every (months)">
            <Input id="split-every" type="number" min={1} max={12} value={split.every} onChange={(e) => setSplit((s) => ({ ...s, every: e.target.value }))} className="w-20" />
          </Field>
          <Button variant="secondary" onClick={applySplit} disabled={p.finalPaise === null || p.finalPaise === 0}>
            <CalendarRange className="size-4" aria-hidden /> Split evenly
          </Button>
        </div>
        {v.installments.length ? (
          <ol className="grid gap-2">
            {v.installments.map((it, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2 sm:grid-cols-[auto_10rem_10rem_1fr_auto]">
                <span className="pb-2 text-xs font-semibold text-muted">#{i + 1}</span>
                <Field id={`inst-${i}-date`} label="Due date">
                  <Input id={`inst-${i}-date`} type="date" value={it.dueDate} onChange={(e) => setInstallment(i, { dueDate: e.target.value })} />
                </Field>
                <Field id={`inst-${i}-amount`} label="Amount">
                  <Input id={`inst-${i}-amount`} inputMode="decimal" value={it.amount} onChange={(e) => setInstallment(i, { amount: e.target.value })} />
                </Field>
                <Field id={`inst-${i}-label`} label="Label (optional)" className="col-span-3 col-start-2 sm:col-span-1 sm:col-start-auto">
                  <Input id={`inst-${i}-label`} value={it.label} onChange={(e) => setInstallment(i, { label: e.target.value })} maxLength={80} placeholder={`Installment ${i + 1}`} />
                </Field>
                <Button size="icon" variant="ghost" className="text-danger-700" aria-label={`Remove installment ${i + 1}`} onClick={() => set("installments", v.installments.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => set("installments", [...v.installments, { dueDate: today, amount: "", label: "" }])} disabled={v.installments.length >= 60}>
            <Plus className="size-4" aria-hidden /> Add installment
          </Button>
          {v.installments.length ? (
            <p className={scheduleOk ? "text-xs text-success-700" : "text-xs font-semibold text-danger-700"} aria-live="polite">
              Installments total {formatPaise(scheduleSum, v.currency || "INR")}
              {scheduleOk ? " ✓ matches the final fee" : p.finalPaise !== null ? ` · ${formatPaise(p.finalPaise - scheduleSum, v.currency || "INR")} ${p.finalPaise > scheduleSum ? "still to schedule" : "too much"}` : ""}
            </p>
          ) : null}
        </div>
        {errors.installments?.[0] ? <p className="text-xs font-medium text-danger-700">{errors.installments[0]}</p> : null}
      </fieldset>

      <Field id="fee-notes" label="Notes (internal)">
        <Textarea id="fee-notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} className="min-h-16" />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !scheduleOk || p.finalPaise === null}>
          {pending ? "Saving…" : "Save fee plan"}
        </Button>
      </div>
      <Feedback result={result} />
    </form>
  );
}
