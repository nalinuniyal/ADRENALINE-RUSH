"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCheck, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { ActionResult } from "@/app/actions/batches";
import { cancelSession, deleteSession, restoreSession, retryGoogleSync, saveAttendance, saveSessionFollowUp, type SessionActionResult } from "@/app/actions/sessions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { ATTENDANCE_LABELS, type AttendanceMark } from "@/lib/batches/attendance";

function Feedback({ result, className }: { result?: SessionActionResult; className?: string }) {
  if (!result?.message && !result?.googleError) return null;
  return (
    <div className={cn("grid gap-2", className)}>
      {result.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      {result.googleError && result.googleError !== result.message ? <Alert tone="warning">{result.googleError}</Alert> : null}
    </div>
  );
}

export function SessionActions({ sessionId, status, batchId }: { sessionId: string; status: string; batchId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SessionActionResult>();
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);

  const run = (fn: () => Promise<SessionActionResult>, after?: () => void) => {
    setResult(undefined);
    start(async () => {
      const res = await fn();
      setConfirm(null);
      if (res.ok && after && !res.googleError) return after();
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap gap-2">
        {status === "cancelled" ? (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => restoreSession(sessionId))}>
            <RotateCcw className="size-4" aria-hidden /> Restore
          </Button>
        ) : (
          <Button variant="secondary" disabled={pending} onClick={() => setConfirm("cancel")} aria-expanded={confirm === "cancel"}>
            <Ban className="size-4" aria-hidden /> Cancel session
          </Button>
        )}
        <Button variant="secondary" className="text-danger-700" disabled={pending} onClick={() => setConfirm("delete")} aria-expanded={confirm === "delete"}>
          <Trash2 className="size-4" aria-hidden /> Delete
        </Button>
      </div>
      {confirm ? (
        <div role="group" aria-label="Confirm" className="w-full max-w-md rounded-lg border border-line bg-canvas/60 p-3 text-sm sm:text-right">
          <p>
            {confirm === "cancel"
              ? "Cancel this session? It stays in the history, and its Google Calendar event (if any) is removed."
              : "Delete this session permanently? Sessions with attendance cannot be deleted; cancel them instead."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
            <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                confirm === "cancel"
                  ? run(() => cancelSession(sessionId))
                  : run(() => deleteSession(sessionId), () => router.push(batchId ? `/admin/batches/${batchId}` : "/admin/calendar"))
              }
            >
              {confirm === "cancel" ? "Cancel session" : "Delete permanently"}
            </Button>
          </div>
        </div>
      ) : null}
      {pending ? (
        <p className="text-xs text-muted" role="status">
          Working…
        </p>
      ) : null}
      <Feedback result={result} className="w-full max-w-md" />
    </div>
  );
}

export function RetryGoogleButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SessionActionResult>();
  return (
    <div className="grid gap-2">
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await retryGoogleSync(sessionId);
              setResult(res);
              router.refresh();
            })
          }
        >
          <RefreshCw className={cn("size-4", pending && "animate-spin")} aria-hidden /> {pending ? "Contacting Google…" : "Retry Google"}
        </Button>
      </div>
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
    </div>
  );
}

type Person = { candidateId: string; name: string; email: string | null; status: AttendanceMark | ""; note: string; detail?: string };

const MARKS: AttendanceMark[] = ["present", "late", "absent", "excused"];
const MARK_STYLES: Record<AttendanceMark, string> = {
  present: "has-[:checked]:bg-success-700 has-[:checked]:text-white",
  late: "has-[:checked]:bg-warning-700 has-[:checked]:text-white",
  absent: "has-[:checked]:bg-danger-700 has-[:checked]:text-white",
  excused: "has-[:checked]:bg-[#5c5c5c] has-[:checked]:text-white",
};

export function AttendanceForm({ sessionId, people, disabledReason }: { sessionId: string; people: Person[]; disabledReason: string | null }) {
  const router = useRouter();
  const [rows, setRows] = useState(people);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  const [dirty, setDirty] = useState(false);

  const set = (id: string, patch: Partial<Person>) => {
    setDirty(true);
    setRows((cur) => cur.map((r) => (r.candidateId === id ? { ...r, ...patch } : r)));
  };
  const save = () => {
    setResult(undefined);
    start(async () => {
      const res = await saveAttendance({ sessionId, marks: rows.map((r) => ({ candidateId: r.candidateId, status: r.status, note: r.note })) });
      setResult(res);
      if (res.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  };

  if (!people.length) return <p className="text-sm text-muted">No one to mark yet.</p>;
  const editable = !disabledReason;

  return (
    <div className="grid gap-3">
      {disabledReason ? <Alert tone="info">{disabledReason}</Alert> : null}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => rows.forEach((r) => set(r.candidateId, { status: "present" }))}>
            <CheckCheck className="size-4" aria-hidden /> Mark all present
          </Button>
          <Button size="sm" variant="ghost" onClick={() => rows.forEach((r) => !r.status && set(r.candidateId, { status: "absent" }))}>
            Mark the rest absent
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {rows.map((r) => (
          <li key={r.candidateId} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.name}</p>
              <p className="truncate text-xs text-muted">{[r.email, r.detail].filter(Boolean).join(" · ")}</p>
            </div>
            <fieldset disabled={!editable || pending} className="flex flex-col gap-1.5 sm:items-end">
              <legend className="sr-only">Attendance for {r.name}</legend>
              <div className="inline-flex overflow-hidden rounded-md border border-line-strong text-xs">
                {MARKS.map((m) => (
                  <label key={m} className={cn("cursor-pointer border-r border-line-strong px-2.5 py-1.5 last:border-r-0 hover:bg-brand-50", MARK_STYLES[m])}>
                    <input type="radio" name={`att-${r.candidateId}`} value={m} checked={r.status === m} onChange={() => set(r.candidateId, { status: m })} className="sr-only" />
                    {ATTENDANCE_LABELS[m]}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`note-${r.candidateId}`}>
                  Note for {r.name}
                </label>
                <Input id={`note-${r.candidateId}`} value={r.note} onChange={(e) => set(r.candidateId, { note: e.target.value })} placeholder="Note (optional)" maxLength={500} className="h-7 py-1 text-xs sm:w-56" />
                {r.status ? (
                  <button type="button" className="text-xs text-muted underline hover:text-fg" onClick={() => set(r.candidateId, { status: "" })}>
                    Clear
                  </button>
                ) : null}
              </div>
            </fieldset>
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={pending || !dirty} aria-busy={pending}>
            {pending ? "Saving…" : "Save attendance"}
          </Button>
          {dirty ? <span className="text-xs text-warning-700">Unsaved changes</span> : null}
        </div>
      ) : null}
      {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
    </div>
  );
}

export function RecordingForm({ sessionId, recordingUrl, completed, cancelled }: { sessionId: string; recordingUrl: string; completed: boolean; cancelled: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(recordingUrl);
  const [done, setDone] = useState(completed);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(undefined);
        start(async () => {
          const res = await saveSessionFollowUp({ sessionId, recordingUrl: url, markCompleted: done });
          setResult(res);
          if (res.ok) router.refresh();
        });
      }}
    >
      <Field id="recording-url" label="Recording link" hint="Unlisted YouTube, Google Drive, Zoom cloud… Only your team sees it here." error={result?.fieldErrors?.recordingUrl?.[0]}>
        <Input id="recording-url" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      {!cancelled ? <Checkbox id="mark-done" label="This session took place" checked={done} onChange={(e) => setDone(e.target.checked)} /> : null}
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
    </form>
  );
}
