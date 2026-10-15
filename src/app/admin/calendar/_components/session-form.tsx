"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSession, updateSession, type SessionActionResult } from "@/app/actions/sessions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { SESSION_STATUS_LABELS, SESSION_STATUSES, sessionSchema, type SessionFormInput, type SessionFormOutput } from "@/lib/validation/batches";

type Option = { value: string; label: string };
export type BatchChoice = { id: string; label: string; timezone: string; instructorId: string | null; defaultMeetingUrl: string | null };
export type DemoPerson = { id: string; name: string; detail: string };

export function SessionForm({
  sessionId,
  initial,
  batches,
  courses,
  instructors,
  demoPeople,
  google,
  canConnectGoogle,
  timeZones,
}: {
  sessionId?: string;
  initial: SessionFormInput;
  batches: BatchChoice[];
  courses: Option[];
  instructors: Option[];
  /** Candidates who requested a demo, per course id. */
  demoPeople: Record<string, DemoPerson[]>;
  google: "connected" | "unavailable";
  canConnectGoogle: boolean;
  timeZones: string[];
}) {
  const router = useRouter();
  const isNew = !sessionId;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SessionActionResult>();
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<SessionFormInput, unknown, SessionFormOutput>({ resolver: zodResolver(sessionSchema), defaultValues: initial });
  const kind = useWatch({ control, name: "kind" });
  const mode = useWatch({ control, name: "meetingMode" });
  const courseId = useWatch({ control, name: "courseId" });
  const attendeeIds = useWatch({ control, name: "attendeeIds" }) ?? [];
  const batchField = register("batchId", {
    onChange: (e: { target: { value: string } }) => {
      const b = batches.find((x) => x.id === e.target.value);
      if (!b || !isNew) return;
      setValue("timezone", b.timezone);
      if (b.instructorId) setValue("instructorId", b.instructorId);
      if (b.defaultMeetingUrl && !getValues("meetingUrl")) {
        setValue("meetingUrl", b.defaultMeetingUrl);
        if (getValues("meetingMode") === "none") setValue("meetingMode", "manual");
      }
    },
  });

  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      const raw = getValues();
      const res = isNew ? await createSession(raw) : await updateSession(sessionId, raw);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as FieldPath<SessionFormInput>, { message: messages[0] });
      }
      if (res.ok && res.id) {
        const qs = new URLSearchParams({ saved: "1" });
        if (res.googleError) qs.set("google", "failed");
        router.push(`/admin/calendar/sessions/${res.id}?${qs.toString()}`);
        router.refresh();
        return;
      }
      setResult(res);
    });
  };

  const err = (name: FieldPath<SessionFormInput>) => (errors as Record<string, { message?: string } | undefined>)[name]?.message;
  const aria = (name: FieldPath<SessionFormInput>, hint?: unknown) => ({ id: name, "aria-invalid": Boolean(err(name)), "aria-describedby": describedBy(name, err(name), hint) });

  const people = courseId ? (demoPeople[courseId] ?? []) : [];
  const knownIds = new Set(people.map((p) => p.id));
  const toggleAttendee = (id: string, on: boolean) => {
    const cur = getValues("attendeeIds") ?? [];
    setValue("attendeeIds", on ? [...cur, id] : cur.filter((x) => x !== id), { shouldDirty: true });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit, () => setResult({ ok: false, message: "Please fix the highlighted fields." }))} noValidate className="grid gap-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-fg">{kind === "demo" ? "Demo session" : "Class session"}</legend>
        {kind === "class" ? (
          <Field id="batchId" label="Batch" required error={err("batchId")} className="sm:col-span-2">
            <Select {...aria("batchId")} {...batchField} disabled={!isNew}>
              <option value="">Choose a batch…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field id="courseId" label="Course" required error={err("courseId")} hint="Free demo class for people interested in this course." className="sm:col-span-2">
            <Select {...aria("courseId", true)} {...register("courseId")} disabled={!isNew}>
              <option value="">Choose a course…</option>
              {courses.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="title" label="Title" required error={err("title")} className="sm:col-span-2">
          <Input {...aria("title")} maxLength={200} {...register("title")} />
        </Field>
        <Field id="date" label="Date" required error={err("date")}>
          <Input type="date" {...aria("date")} {...register("date")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="startTime" label="Starts" required error={err("startTime")}>
            <Input type="time" {...aria("startTime")} {...register("startTime")} />
          </Field>
          <Field id="endTime" label="Ends" required error={err("endTime")}>
            <Input type="time" {...aria("endTime")} {...register("endTime")} />
          </Field>
        </div>
        <Field id="timezone" label="Time zone" required error={err("timezone")} hint="The date and times above are in this zone.">
          <Input list="session-tz-list" {...aria("timezone", true)} {...register("timezone")} />
        </Field>
        <datalist id="session-tz-list">
          {timeZones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <Field id="instructorId" label="Instructor" error={err("instructorId")}>
          <Select {...aria("instructorId")} {...register("instructorId")}>
            <option value="">Not assigned</option>
            {instructors.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
        </Field>
        {!isNew ? (
          <Field id="status" label="Status" error={err("status")}>
            <Select {...aria("status")} {...register("status")}>
              {SESSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SESSION_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-bold text-fg">Meeting link</legend>
        <div role="radiogroup" aria-label="Meeting link" className="grid gap-2 sm:grid-cols-3">
          {[
            { value: "manual", label: "Paste a link", hint: "Zoom, Meet, Teams… any https link" },
            { value: "google", label: "Create Google Meet link", hint: google === "connected" ? "Adds a Google Calendar event" : "Connect Google first" },
            { value: "none", label: "No link yet", hint: "Add one later" },
          ].map((o) => {
            const disabled = o.value === "google" && google !== "connected" && initial.meetingMode !== "google";
            return (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50 ${disabled ? "cursor-not-allowed opacity-60" : "border-line-strong"}`}
              >
                <input type="radio" value={o.value} disabled={disabled} className="mt-0.5 accent-brand-600" {...register("meetingMode")} />
                <span>
                  <span className="font-medium">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {google !== "connected" ? (
          <p className="text-xs text-muted">
            Google Calendar is not connected.{" "}
            {canConnectGoogle ? (
              <Link href="/admin/settings#integrations" className="text-brand-700 underline">
                Connect it in Settings
              </Link>
            ) : (
              "Ask the owner to connect it in Settings."
            )}{" "}
            Scheduling works without it.
          </p>
        ) : null}
        {mode === "manual" ? (
          <Field id="meetingUrl" label="Meeting link" required error={err("meetingUrl")}>
            <Input type="url" inputMode="url" placeholder="https://" {...aria("meetingUrl")} {...register("meetingUrl")} />
          </Field>
        ) : null}
        {mode === "google" ? (
          <Checkbox
            id="addAttendees"
            label={kind === "demo" ? "Invite the people below by email (Google sends the invitation)" : "Invite enrolled students by email (Google sends the invitation)"}
            description="Off by default. Students then also see the class in their own calendar."
            {...register("addAttendees")}
          />
        ) : null}
      </fieldset>

      {kind === "demo" ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-bold text-fg">Who is attending</legend>
          {!courseId ? (
            <p className="text-sm text-muted">Choose the course to see who requested a demo.</p>
          ) : people.length === 0 && attendeeIds.length === 0 ? (
            <p className="text-sm text-muted">Nobody you can see has requested a demo for this course yet.</p>
          ) : (
            <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
              {attendeeIds
                .filter((id) => !knownIds.has(id))
                .map((id) => (
                  <li key={id}>
                    <label className="flex items-start gap-2 rounded px-2 py-1 text-sm hover:bg-canvas">
                      <input type="checkbox" checked onChange={(e) => toggleAttendee(id, e.target.checked)} className="mt-0.5 accent-brand-600" />
                      <span>Previously invited person</span>
                    </label>
                  </li>
                ))}
              {people.map((p) => (
                <li key={p.id}>
                  <label className="flex items-start gap-2 rounded px-2 py-1 text-sm hover:bg-canvas">
                    <input type="checkbox" checked={attendeeIds.includes(p.id)} onChange={(e) => toggleAttendee(p.id, e.target.checked)} className="mt-0.5 accent-brand-600" />
                    <span className="min-w-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted">{p.detail}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Listed: candidates who booked a demo for this course (newest first).</p>
        </fieldset>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-fg">Details</legend>
        <Field id="description" label="Description" error={err("description")} hint="Shared in the Google Calendar event, if used.">
          <Textarea rows={3} {...aria("description", true)} maxLength={4000} {...register("description")} />
        </Field>
        <Field id="prepNotes" label="Preparation instructions" error={err("prepNotes")} hint="What to install or read before the session.">
          <Textarea rows={3} {...aria("prepNotes", true)} maxLength={4000} {...register("prepNotes")} />
        </Field>
        <Field id="recordingUrl" label="Recording link" error={err("recordingUrl")} hint="Add after the class (YouTube unlisted, Drive…)">
          <Input type="url" inputMode="url" placeholder="https://" {...aria("recordingUrl", true)} {...register("recordingUrl")} />
        </Field>
        <Field id="notes" label="Internal notes" error={err("notes")} hint="Only your team sees these.">
          <Textarea rows={3} {...aria("notes", true)} maxLength={4000} {...register("notes")} />
        </Field>
      </fieldset>

      {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? (mode === "google" ? "Saving and contacting Google…" : "Saving…") : isNew ? "Create session" : "Save session"}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
