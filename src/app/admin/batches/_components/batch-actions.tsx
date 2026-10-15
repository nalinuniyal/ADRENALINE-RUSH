"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, Search, Trash2, UserPlus } from "lucide-react";
import {
  deleteBatch,
  enrollCandidate,
  generateBatchSessions,
  searchCandidatesForBatch,
  setEnrollmentStatus,
  transferEnrollment,
  type ActionResult,
  type CandidateHit,
} from "@/app/actions/batches";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { WEEKDAYS } from "@/lib/batches/schedule";
import { ENROLLMENT_STATUS_LABELS, ENROLLMENT_STATUSES, type EnrollmentStatus } from "@/lib/validation/batches";

function Feedback({ result, className }: { result?: ActionResult; className?: string }) {
  if (!result?.message) return null;
  return (
    <Alert tone={result.ok ? "success" : "danger"} className={className}>
      {result.message}
    </Alert>
  );
}

export function DeleteBatchButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  return (
    <div className="flex flex-col items-end gap-2">
      {confirm ? (
        <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Delete this batch?</span>
          <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>
            Keep
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteBatch(batchId);
                if (res.ok) {
                  router.push("/admin/batches");
                  return;
                }
                setResult(res);
                setConfirm(false);
              })
            }
          >
            Delete
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="text-danger-700" onClick={() => setConfirm(true)}>
          <Trash2 className="size-4" aria-hidden /> Delete
        </Button>
      )}
      <Feedback result={result} className="max-w-sm" />
    </div>
  );
}

/** Search the CRM and enroll someone into this batch. */
export function EnrollForm({ batchId, disabledReason }: { batchId: string; disabledReason?: string | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CandidateHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  const [status, setStatus] = useState<"active" | "pending">("active");
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      setSearching(true);
      const res = await searchCandidatesForBatch(batchId, term).catch(() => []);
      if (seq.current === mine) {
        setHits(res);
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, batchId]);

  const enroll = (candidateId: string) => {
    setResult(undefined);
    start(async () => {
      const res = await enrollCandidate({ batchId, candidateId, status });
      setResult(res);
      if (res.ok) {
        setQ("");
        setHits(null);
        router.refresh();
      }
    });
  };

  if (disabledReason) return <p className="text-sm text-muted">{disabledReason}</p>;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field id="enroll-search" label="Find a candidate" hint="Type a name, email or phone number.">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              id="enroll-search"
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (e.target.value.trim().length < 2) setHits(null);
              }}
              placeholder="Search candidates"
              className="pl-9"
              autoComplete="off"
              aria-describedby="enroll-search-hint"
            />
          </div>
        </Field>
        <Field id="enroll-status" label="Enroll as">
          <Select id="enroll-status" value={status} onChange={(e) => setStatus(e.target.value as "active" | "pending")}>
            <option value="active">Active student</option>
            <option value="pending">Pending confirmation</option>
          </Select>
        </Field>
      </div>
      <div aria-live="polite" className="text-xs text-muted">
        {searching ? "Searching…" : hits && hits.length === 0 ? "No matching candidates you can see. Add them under Candidates first." : null}
      </div>
      {hits?.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {hits.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{h.fullName}</p>
                <p className="truncate text-xs text-muted">{h.detail || "No contact details"}</p>
              </div>
              {h.enrolled ? (
                <span className="flex items-center gap-1 text-xs text-success-700">
                  <Check className="size-3.5" aria-hidden /> Enrolled
                </span>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => enroll(h.id)} aria-label={`Enroll ${h.fullName}`}>
                  <UserPlus className="size-4" aria-hidden /> Enroll
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <Feedback result={result} />
    </div>
  );
}

/** Status change and transfer for one roster row. */
export function EnrollmentControls({
  enrollmentId,
  status,
  name,
  transferTargets,
}: {
  enrollmentId: string;
  status: EnrollmentStatus;
  name: string;
  transferTargets: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState("");

  const run = (fn: () => Promise<ActionResult>) => {
    setResult(undefined);
    start(async () => {
      const res = await fn();
      setResult(res.ok ? undefined : res);
      if (res.ok) {
        setMoving(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`st-${enrollmentId}`}>
          Enrollment status for {name}
        </label>
        <Select
          id={`st-${enrollmentId}`}
          value={status}
          disabled={pending}
          className="h-8 w-auto py-1 text-xs"
          onChange={(e) => run(() => setEnrollmentStatus({ enrollmentId, status: e.target.value }))}
        >
          {ENROLLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ENROLLMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        {transferTargets.length ? (
          <Button size="xs" variant="secondary" onClick={() => setMoving((m) => !m)} aria-expanded={moving} disabled={pending}>
            <ArrowRightLeft className="size-3.5" aria-hidden /> Transfer
          </Button>
        ) : null}
      </div>
      {moving ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`tr-${enrollmentId}`}>
            Move {name} to
          </label>
          <Select id={`tr-${enrollmentId}`} value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-auto py-1 text-xs">
            <option value="">Move to batch…</option>
            {transferTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
          <Button size="xs" disabled={!target || pending} onClick={() => run(() => transferEnrollment({ enrollmentId, batchId: target }))}>
            Move
          </Button>
        </div>
      ) : null}
      <Feedback result={result} className="max-w-xs text-xs" />
    </div>
  );
}

export function GenerateSessionsForm({
  batchId,
  defaults,
}: {
  batchId: string;
  defaults: { startDate: string; endDate: string; days: number[]; startTime: string; endTime: string; timezone: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult & { fieldErrors?: Record<string, string[] | undefined> }>();
  const [days, setDays] = useState<number[]>(defaults.days);
  const [useEnd, setUseEnd] = useState(Boolean(defaults.endDate));

  const submit = (form: FormData) => {
    setResult(undefined);
    start(async () => {
      const res = await generateBatchSessions({
        batchId,
        startDate: String(form.get("startDate") ?? ""),
        endDate: useEnd ? String(form.get("endDate") ?? "") : "",
        weeks: useEnd ? "" : String(form.get("weeks") ?? ""),
        days,
        startTime: String(form.get("startTime") ?? ""),
        endTime: String(form.get("endTime") ?? ""),
        titlePrefix: String(form.get("titlePrefix") ?? "Class"),
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  };
  const fe = (k: string) => result?.fieldErrors?.[k]?.[0];

  return (
    <form action={submit} className="grid gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="gen-start" label="First date" required error={fe("startDate")}>
          <Input id="gen-start" name="startDate" type="date" defaultValue={defaults.startDate} required />
        </Field>
        <div className="flex flex-col gap-1">
          <div className="flex gap-3 text-xs font-medium text-[#444]" role="radiogroup" aria-label="How long">
            <label className="flex items-center gap-1">
              <input type="radio" checked={!useEnd} onChange={() => setUseEnd(false)} className="accent-brand-600" /> For N weeks
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={useEnd} onChange={() => setUseEnd(true)} className="accent-brand-600" /> Until a date
            </label>
          </div>
          {useEnd ? (
            <Input aria-label="Last date" name="endDate" type="date" defaultValue={defaults.endDate} />
          ) : (
            <Input aria-label="Number of weeks" name="weeks" inputMode="numeric" defaultValue="8" />
          )}
          {fe("weeks") || fe("endDate") ? <p className="text-xs font-medium text-danger-700">{fe("weeks") ?? fe("endDate")}</p> : null}
        </div>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-[#444]">Class days</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <label key={d.value} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-sm has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50">
              <input
                type="checkbox"
                aria-label={d.label}
                className="size-4 accent-brand-600"
                checked={days.includes(d.value)}
                onChange={(e) => setDays((cur) => (e.target.checked ? [...cur, d.value] : cur.filter((x) => x !== d.value)))}
              />
              {d.short}
            </label>
          ))}
        </div>
        {fe("days") ? <p className="mt-1 text-xs font-medium text-danger-700">{fe("days")}</p> : null}
      </fieldset>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field id="gen-st" label="Starts" required error={fe("startTime")}>
          <Input id="gen-st" name="startTime" type="time" defaultValue={defaults.startTime} required />
        </Field>
        <Field id="gen-et" label="Ends" required error={fe("endTime")}>
          <Input id="gen-et" name="endTime" type="time" defaultValue={defaults.endTime} required />
        </Field>
        <Field id="gen-title" label="Title" hint="Numbered: Class 1, Class 2…" className="col-span-2 sm:col-span-1">
          <Input id="gen-title" name="titlePrefix" defaultValue="Class" maxLength={150} />
        </Field>
      </div>
      <p className="text-xs text-muted">Times are in {defaults.timezone}. Classes that already exist at the same time are skipped.</p>
      <div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Creating…" : "Generate classes"}
        </Button>
      </div>
      <Feedback result={result} />
    </form>
  );
}
