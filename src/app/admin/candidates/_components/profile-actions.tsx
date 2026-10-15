"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import {
  addCandidateNote,
  addFollowUp,
  setCandidateOwner,
  setCandidateStatus,
  setFollowUpStatus,
  type ActionResult,
} from "@/app/actions/candidates";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { LeadStatusColor } from "@/lib/validation/candidates";
import { CandidateForm, type CandidateFormValues } from "./candidate-form";

type Option = { value: string; label: string };

function Feedback({ result }: { result?: ActionResult }) {
  if (!result?.message) return null;
  return <Alert tone={result.ok ? "success" : "danger"} className="mt-2">{result.message}</Alert>;
}

const PATH_COLORS: Record<LeadStatusColor, string> = {
  neutral: "bg-[#5c5c5c]",
  brand: "bg-brand-600",
  success: "bg-success-700",
  warning: "bg-warning-700",
  danger: "bg-danger-700",
  violet: "bg-[#6b2ec2]",
  teal: "bg-[#04756d]",
};

/** Salesforce-style path: completed steps, the current step, and the rest. Click a step to move there. */
export function StatusPath({
  candidateId,
  statuses,
  currentId,
  canEdit,
}: {
  candidateId: string;
  statuses: { id: string; label: string; color: LeadStatusColor; is_closed: boolean }[];
  currentId: string | null;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult>();
  const currentIndex = statuses.findIndex((s) => s.id === currentId);

  const choose = (id: string) => {
    if (id === currentId || pending) return;
    setTarget(id);
    setResult(undefined);
    startTransition(async () => {
      const res = await setCandidateStatus({ candidateId, leadStatusId: id });
      setResult(res.ok ? undefined : res);
      setTarget(null);
    });
  };

  return (
    <div className="mb-4 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-card">
      <h2 className="sr-only">Lead status</h2>
      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Lead status path">
        {statuses.map((s, i) => {
          const isCurrent = s.id === currentId;
          const done = currentIndex >= 0 && i < currentIndex;
          const loading = pending && target === s.id;
          const cls = cn(
            "flex h-9 min-w-max items-center gap-1.5 px-5 text-xs font-semibold whitespace-nowrap transition-colors [clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%,10px_50%)] first:[clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%)] first:rounded-l-full first:pl-4 last:[clip-path:polygon(0_0,100%_0,100%_100%,0_100%,10px_50%)] last:rounded-r-full",
            isCurrent ? cn(PATH_COLORS[s.color], "text-white") : done ? "bg-brand-100 text-brand-800" : "bg-[#ecebea] text-[#3e3e3c]",
            canEdit && !isCurrent && "cursor-pointer hover:bg-brand-600 hover:text-white focus-visible:bg-brand-600 focus-visible:text-white",
            loading && "animate-pulse",
          );
          return (
            <li key={s.id} className="flex">
              {canEdit ? (
                <button
                  type="button"
                  className={cls}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={isCurrent ? `${s.label} (current status)` : `Change status to ${s.label}`}
                  disabled={pending}
                  onClick={() => choose(s.id)}
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : null}
                  {s.label}
                </button>
              ) : (
                <span className={cls} aria-current={isCurrent ? "step" : undefined}>
                  {done ? <Check className="size-3.5" aria-hidden /> : null}
                  {s.label}
                  {isCurrent ? <span className="sr-only"> (current status)</span> : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div aria-live="polite">
        {pending ? <p className="mt-2 text-xs text-muted">Updating status…</p> : null}
        <Feedback result={result} />
      </div>
    </div>
  );
}

export function OwnerSelect({ candidateId, ownerId, owners }: { candidateId: string; ownerId: string | null; owners: Option[] }) {
  const [value, setValue] = useState(ownerId ?? "");
  const [result, setResult] = useState<ActionResult>();
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      setResult(await setCandidateOwner({ candidateId, ownerId: value || null }));
    });
  return (
    <div className="grid gap-2">
      <label htmlFor="owner-select" className="text-xs font-medium text-[#444]">Assigned to</label>
      <div className="flex gap-2">
        <Select id="owner-select" value={value} onChange={(e) => setValue(e.target.value)} disabled={pending}>
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Button size="md" variant="secondary" onClick={save} disabled={pending || value === (ownerId ?? "")} aria-busy={pending}>
          {pending ? "Saving…" : "Assign"}
        </Button>
      </div>
      <div aria-live="polite"><Feedback result={result} /></div>
    </div>
  );
}

export function NoteForm({ candidateId }: { candidateId: string }) {
  const [body, setBody] = useState("");
  const [result, setResult] = useState<ActionResult>();
  const [pending, startTransition] = useTransition();
  const error = result?.fieldErrors?.body?.[0];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await addCandidateNote({ candidateId, body });
      setResult(res);
      if (res.ok) setBody("");
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-2" noValidate>
      <Field id="note-body" label="Add a note" error={error}>
        <Textarea
          id="note-body"
          rows={3}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Call summary, questions they asked, next steps…"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy("note-body", error)}
        />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={pending || body.trim() === ""} aria-busy={pending}>{pending ? "Saving…" : "Add note"}</Button>
      </div>
      <div aria-live="polite">{result && !result.fieldErrors ? <Feedback result={result} /> : null}</div>
    </form>
  );
}

export function FollowUpForm({
  candidateId,
  defaultDate,
  timeZone,
  owners,
  currentUserId,
}: {
  candidateId: string;
  defaultDate: string;
  timeZone: string;
  owners: Option[];
  currentUserId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<ActionResult>();
  const [pending, startTransition] = useTransition();
  const err = (k: string) => result?.fieldErrors?.[k]?.[0];
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await addFollowUp({
        candidateId,
        title: String(fd.get("title") ?? ""),
        dueDate: String(fd.get("dueDate") ?? ""),
        dueTime: String(fd.get("dueTime") ?? ""),
        assignedTo: String(fd.get("assignedTo") ?? "") || null,
        notes: String(fd.get("notes") ?? ""),
      });
      setResult(res);
      if (res.ok) formRef.current?.reset();
    });
  };
  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-3" noValidate>
      <Field id="fu-title" label="What needs to happen?" error={err("title")} required>
        <Input id="fu-title" name="title" maxLength={200} placeholder="e.g. Call to discuss batch timings" aria-invalid={Boolean(err("title"))} aria-describedby={describedBy("fu-title", err("title"))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="fu-date" label="Date" error={err("dueDate")} required>
          <Input id="fu-date" name="dueDate" type="date" defaultValue={defaultDate} aria-invalid={Boolean(err("dueDate"))} aria-describedby={describedBy("fu-date", err("dueDate"))} />
        </Field>
        <Field id="fu-time" label="Time" error={err("dueTime")} hint={timeZone} required>
          <Input id="fu-time" name="dueTime" type="time" defaultValue="10:00" aria-invalid={Boolean(err("dueTime"))} aria-describedby={describedBy("fu-time", err("dueTime"), timeZone)} />
        </Field>
      </div>
      {owners.length > 1 ? (
        <Field id="fu-assigned" label="Assigned to" error={err("assignedTo")}>
          <Select id="fu-assigned" name="assignedTo" defaultValue={currentUserId}>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field id="fu-notes" label="Notes" error={err("notes")}>
        <Textarea id="fu-notes" name="notes" rows={2} maxLength={4000} className="min-h-16" />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>{pending ? "Scheduling…" : "Schedule follow-up"}</Button>
      </div>
      <div aria-live="polite">{result && !result.fieldErrors ? <Feedback result={result} /> : null}</div>
    </form>
  );
}

export function TaskActions({ taskId, status, title }: { taskId: string; status: "open" | "done" | "cancelled"; title: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  const set = (next: "open" | "done" | "cancelled") =>
    startTransition(async () => {
      const res = await setFollowUpStatus({ taskId, status: next });
      setResult(res.ok ? undefined : res);
    });
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-1">
        {status === "open" ? (
          <>
            <Button size="xs" variant="success" onClick={() => set("done")} disabled={pending} aria-label={`Mark “${title}” as done`}>
              <Check className="size-3.5" aria-hidden /> Done
            </Button>
            <Button size="xs" variant="ghost" onClick={() => set("cancelled")} disabled={pending} aria-label={`Cancel “${title}”`}>
              <X className="size-3.5" aria-hidden /> Cancel
            </Button>
          </>
        ) : (
          <Button size="xs" variant="ghost" onClick={() => set("open")} disabled={pending} aria-label={`Reopen “${title}”`}>Reopen</Button>
        )}
      </div>
      {result?.message ? <p role="alert" className="text-xs text-danger-700">{result.message}</p> : null}
    </div>
  );
}

/** Read-only details with an Edit toggle that swaps in the candidate form. */
export function EditableDetails({
  candidateId,
  initial,
  canEdit,
  children,
}: {
  candidateId: string;
  initial: CandidateFormValues;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      {canEdit ? (
        <div className="mb-3 flex justify-end">
          <Button size="xs" variant="secondary" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            {editing ? <X className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
            {editing ? "Close editor" : "Edit details"}
          </Button>
        </div>
      ) : null}
      {editing ? <CandidateForm mode="edit" candidateId={candidateId} initial={initial} onSaved={() => setEditing(false)} /> : children}
    </div>
  );
}
