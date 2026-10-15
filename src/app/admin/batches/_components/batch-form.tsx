"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createBatch, updateBatch } from "@/app/actions/batches";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { WEEKDAYS } from "@/lib/batches/schedule";
import { DELIVERY_MODES } from "@/lib/format";
import { BATCH_STATUS_LABELS, BATCH_STATUSES, batchSchema, type BatchFormInput, type BatchFormOutput } from "@/lib/validation/batches";

type Option = { value: string; label: string };

export function BatchForm({
  batchId,
  initial,
  courses,
  instructors,
  timeZones,
}: {
  batchId?: string;
  initial: BatchFormInput;
  courses: Option[];
  instructors: Option[];
  timeZones: string[];
}) {
  const router = useRouter();
  const isNew = !batchId;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string }>();
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    reset,
    formState: { errors },
  } = useForm<BatchFormInput, unknown, BatchFormOutput>({ resolver: zodResolver(batchSchema), defaultValues: initial });

  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      const raw = getValues();
      const res = isNew ? await createBatch(raw) : await updateBatch(batchId, raw);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as FieldPath<BatchFormInput>, { message: messages[0] });
      }
      if (res.ok && res.id) {
        reset(raw);
        router.push(`/admin/batches/${res.id}${isNew ? "?created=1" : ""}`);
        router.refresh();
        return;
      }
      setResult(res);
    });
  };

  const err = (name: FieldPath<BatchFormInput>) => {
    const e = name.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], errors) as { message?: string } | undefined;
    return e?.message;
  };
  const aria = (name: FieldPath<BatchFormInput>, hint?: unknown) => ({
    id: name,
    "aria-invalid": Boolean(err(name)),
    "aria-describedby": describedBy(name, err(name), hint),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit, () => setResult({ ok: false, message: "Please fix the highlighted fields." }))} noValidate className="grid gap-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-fg">Batch</legend>
        <Field id="courseId" label="Course" required error={err("courseId")} className="sm:col-span-2">
          <Select {...aria("courseId")} {...register("courseId")}>
            <option value="">Choose a course…</option>
            {courses.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="name" label="Batch name" required error={err("name")} hint="e.g. October 2026 weekend batch">
          <Input {...aria("name", true)} maxLength={120} {...register("name")} />
        </Field>
        <Field id="code" label="Short code (optional)" error={err("code")} hint="e.g. MCP-OCT26. Must be unique.">
          <Input {...aria("code", true)} maxLength={30} {...register("code")} />
        </Field>
        <Field id="status" label="Status" required error={err("status")}>
          <Select {...aria("status")} {...register("status")}>
            {BATCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BATCH_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="deliveryMode" label="Delivery mode" required error={err("deliveryMode")}>
          <Select {...aria("deliveryMode")} {...register("deliveryMode")}>
            {DELIVERY_MODES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="capacity" label="Capacity (seats)" error={err("capacity")} hint="Leave empty for no limit. Enrollment stops when full.">
          <Input {...aria("capacity", true)} inputMode="numeric" {...register("capacity")} />
        </Field>
        <Field id="instructorId" label="Instructor" error={err("instructorId")} hint="Instructors see only the batches they teach.">
          <Select {...aria("instructorId", true)} {...register("instructorId")}>
            <option value="">Not assigned</option>
            {instructors.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-fg">Schedule</legend>
        <Field id="startDate" label="Start date" error={err("startDate")}>
          <Input type="date" {...aria("startDate")} {...register("startDate")} />
        </Field>
        <Field id="endDate" label="End date" error={err("endDate")}>
          <Input type="date" {...aria("endDate")} {...register("endDate")} />
        </Field>
        <div className="sm:col-span-2">
          <p id="classDays-label" className="text-xs font-medium text-[#444]">
            Class days
          </p>
          <div role="group" aria-labelledby="classDays-label" className="mt-1 flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-sm has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50">
                <input type="checkbox" value={String(d.value)} aria-label={d.label} className="size-4 accent-brand-600" {...register("classDays")} />
                <span aria-hidden>{d.short}</span>
              </label>
            ))}
          </div>
        </div>
        <Field id="startTime" label="Class starts" error={err("startTime")}>
          <Input type="time" {...aria("startTime")} {...register("startTime")} />
        </Field>
        <Field id="endTime" label="Class ends" error={err("endTime")}>
          <Input type="time" {...aria("endTime")} {...register("endTime")} />
        </Field>
        <Field id="timezone" label="Time zone" required error={err("timezone")} hint="Class times are in this zone. Defaults to your business time zone.">
          <Input list="tz-list" {...aria("timezone", true)} {...register("timezone")} />
        </Field>
        <datalist id="tz-list">
          {timeZones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <Field id="scheduleNote" label="Schedule note (optional)" error={err("scheduleNote")} hint="Shown instead of the days/times, e.g. “Weekends 11am, plus 2 doubt-clearing calls”.">
          <Input {...aria("scheduleNote", true)} maxLength={200} {...register("scheduleNote")} />
        </Field>
        <Field id="defaultMeetingUrl" label="Default meeting link (optional)" error={err("defaultMeetingUrl")} hint="Any https link (Zoom, Meet, Teams). Used for classes you generate." className="sm:col-span-2">
          <Input type="url" inputMode="url" placeholder="https://" {...aria("defaultMeetingUrl", true)} {...register("defaultMeetingUrl")} />
        </Field>
      </fieldset>

      <Field id="notes" label="Internal notes" error={err("notes")} hint="Only visible to your team.">
        <Textarea rows={3} {...aria("notes", true)} maxLength={4000} {...register("notes")} />
      </Field>

      {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : isNew ? "Create batch" : "Save batch"}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
