"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Pencil, Plus, Trash2 } from "lucide-react";
import { addExpenseCategory, deleteExpenseCategory, saveExpense, updateExpenseCategory, voidExpense, type FinanceActionResult } from "@/app/actions/finance";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MANUAL_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/finance/money";
import { Feedback } from "./reminder-buttons";

export type ExpenseValues = {
  categoryId: string;
  spentOn: string;
  amount: string;
  currency: string;
  description: string;
  vendor: string;
  method: string;
  reference: string;
  notes: string;
  receiptUrl: string;
  courseId: string;
  batchId: string;
};
type Opt = { id: string; label: string };

export function ExpenseForm({
  expenseId,
  initial,
  categories,
  courses,
  batches,
  onDone,
}: {
  expenseId?: string;
  initial: ExpenseValues;
  categories: Opt[];
  courses: Opt[];
  batches: (Opt & { courseId: string })[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  const errors = result?.fieldErrors ?? {};
  const set = (k: keyof ExpenseValues, value: string) => setV((s) => ({ ...s, [k]: value }));
  const batchChoices = v.courseId ? batches.filter((b) => b.courseId === v.courseId) : batches;
  const p = expenseId ?? "new";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(undefined);
    start(async () => {
      const res = await saveExpense(v, expenseId ?? null);
      setResult(res);
      if (res.ok) {
        if (!expenseId) setV({ ...initial, categoryId: v.categoryId, spentOn: v.spentOn });
        router.refresh();
        onDone?.();
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={`${p}-date`} label="Date" required error={errors.spentOn?.[0]}>
          <Input id={`${p}-date`} type="date" value={v.spentOn} onChange={(e) => set("spentOn", e.target.value)} />
        </Field>
        <Field id={`${p}-cat`} label="Category" required error={errors.categoryId?.[0]}>
          <Select id={`${p}-cat`} value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)} aria-invalid={Boolean(errors.categoryId)}>
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}-amount`} label={`Amount (${v.currency || "INR"})`} required error={errors.amount?.[0]}>
          <Input id={`${p}-amount`} inputMode="decimal" value={v.amount} onChange={(e) => set("amount", e.target.value)} aria-invalid={Boolean(errors.amount)} />
        </Field>
        <Field id={`${p}-desc`} label="Description" required error={errors.description?.[0]} className="sm:col-span-2 lg:col-span-1">
          <Input id={`${p}-desc`} value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={200} placeholder="e.g. Instagram ads for October batch" />
        </Field>
        <Field id={`${p}-vendor`} label="Vendor / payee">
          <Input id={`${p}-vendor`} value={v.vendor} onChange={(e) => set("vendor", e.target.value)} maxLength={120} />
        </Field>
        <Field id={`${p}-method`} label="Paid by" required>
          <Select id={`${p}-method`} value={v.method} onChange={(e) => set("method", e.target.value)}>
            {MANUAL_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}-course`} label="Course (optional)">
          <Select id={`${p}-course`} value={v.courseId} onChange={(e) => setV((s) => ({ ...s, courseId: e.target.value, batchId: "" }))}>
            <option value="">Not linked</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}-batch`} label="Batch (optional)">
          <Select id={`${p}-batch`} value={v.batchId} onChange={(e) => set("batchId", e.target.value)}>
            <option value="">Not linked</option>
            {batchChoices.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${p}-ref`} label="Reference / invoice no.">
          <Input id={`${p}-ref`} value={v.reference} onChange={(e) => set("reference", e.target.value)} maxLength={120} />
        </Field>
        <Field id={`${p}-receipt`} label="Receipt link (optional)" error={errors.receiptUrl?.[0]} hint="e.g. a Google Drive link to the bill">
          <Input id={`${p}-receipt`} type="url" value={v.receiptUrl} onChange={(e) => set("receiptUrl", e.target.value)} maxLength={500} placeholder="https://" />
        </Field>
        <Field id={`${p}-notes`} label="Notes" className="sm:col-span-2">
          <Textarea id={`${p}-notes`} value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} className="min-h-12" />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : expenseId ? "Save changes" : "Add expense"}
        </Button>
        {onDone ? (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
      <Feedback result={result} />
    </form>
  );
}

/** Edit / void controls for one expense row. */
export function ExpenseRowActions(props: { expenseId: string; initial: ExpenseValues; categories: Opt[]; courses: Opt[]; batches: (Opt & { courseId: string })[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "edit" | "void">("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  return (
    <div className="grid gap-2">
      <div className="flex gap-1.5">
        <Button size="xs" variant="ghost" onClick={() => setMode(mode === "edit" ? "" : "edit")} aria-expanded={mode === "edit"}>
          <Pencil className="size-3.5" aria-hidden /> Edit
        </Button>
        <Button size="xs" variant="ghost" className="text-danger-700" onClick={() => setMode(mode === "void" ? "" : "void")} aria-expanded={mode === "void"}>
          <Ban className="size-3.5" aria-hidden /> Void
        </Button>
      </div>
      {mode === "edit" ? (
        <div className="rounded-md border border-line bg-canvas/60 p-3">
          <ExpenseForm {...props} onDone={() => setMode("")} />
        </div>
      ) : null}
      {mode === "void" ? (
        <div className="grid gap-2 rounded-md border border-line bg-canvas/60 p-2">
          <Field id={`void-exp-${props.expenseId}`} label="Why void this expense?" required>
            <Input id={`void-exp-${props.expenseId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                start(async () => {
                  const res = await voidExpense({ id: props.expenseId, reason });
                  setResult(res);
                  if (res.ok) {
                    setMode("");
                    router.refresh();
                  }
                })
              }
            >
              Void expense
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

/** Add, rename, switch off and delete expense categories. */
export function CategoryManager({ categories }: { categories: { id: string; name: string; is_active: boolean; used: boolean }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(categories.map((c) => [c.id, c.name])));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();
  const run = (fn: () => Promise<FinanceActionResult>, after?: () => void) => {
    setResult(undefined);
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  };
  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {categories.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`cat-${c.id}`} className="sr-only">
              Category name
            </label>
            <Input id={`cat-${c.id}`} value={names[c.id] ?? ""} onChange={(e) => setNames((s) => ({ ...s, [c.id]: e.target.value }))} className="max-w-48 flex-1" maxLength={60} />
            {names[c.id] !== c.name ? (
              <Button size="xs" disabled={pending} onClick={() => run(() => updateExpenseCategory(c.id, { name: names[c.id] }))}>
                Save
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => updateExpenseCategory(c.id, { isActive: !c.is_active }))}>
              {c.is_active ? "Switch off" : "Switch on"}
            </Button>
            {!c.used ? (
              <Button size="xs" variant="ghost" className="text-danger-700" disabled={pending} onClick={() => run(() => deleteExpenseCategory(c.id))} aria-label={`Delete ${c.name}`}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addExpenseCategory({ name }), () => setName(""));
        }}
      >
        <Field id="cat-new" label="New category" error={result?.fieldErrors?.name?.[0]}>
          <Input id="cat-new" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="max-w-48" />
        </Field>
        <Button type="submit" size="sm" variant="secondary" disabled={pending || !name.trim()}>
          <Plus className="size-4" aria-hidden /> Add
        </Button>
      </form>
      <Feedback result={result?.fieldErrors ? undefined : result} />
    </div>
  );
}
