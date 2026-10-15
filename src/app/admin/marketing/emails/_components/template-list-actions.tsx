"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { createTemplate, deleteTemplate, duplicateTemplate, type EmailActionResult } from "@/app/actions/email";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { describedBy, Field, Input, Select } from "@/components/ui/field";
import { newTemplateSchema } from "@/lib/validation/email";

type NewInput = z.input<typeof newTemplateSchema>;

export function TemplateRowActions({ id, name, canManage, inUse }: { id: string; name: string; canManage: boolean; inUse: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<EmailActionResult>();

  if (!canManage) {
    return (
      <Link href={`/admin/marketing/emails/templates/${id}`} className={buttonVariants({ variant: "secondary", size: "sm" })} aria-label={`View ${name}`}>
        View
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap gap-1">
        <Link href={`/admin/marketing/emails/templates/${id}`} className={buttonVariants({ variant: "secondary", size: "sm" })} aria-label={`Edit ${name}`}>
          <Pencil className="size-4" aria-hidden /> Edit
        </Link>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={`Duplicate ${name}`}
          onClick={() =>
            startTransition(async () => {
              const res = await duplicateTemplate(id);
              setResult(res);
              if (res.ok && res.id) router.push(`/admin/marketing/emails/templates/${res.id}`);
            })
          }
        >
          <Copy className="size-4" aria-hidden /> Copy
        </Button>
        <Button size="sm" variant="ghost" className="text-danger-700 hover:bg-danger-50" onClick={() => setConfirm((c) => !c)} aria-expanded={confirm} aria-label={`Delete ${name}`}>
          <Trash2 className="size-4" aria-hidden /> Delete
        </Button>
      </div>
      {confirm ? (
        <div role="group" aria-label={`Confirm deleting ${name}`} className="flex flex-wrap items-center gap-2 rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
          <span className="flex-1">{inUse ? "An automation uses this template, so it cannot be deleted yet." : `Delete “${name}”?`}</span>
          <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          {!inUse ? (
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteTemplate(id);
                  setResult(res);
                  setConfirm(false);
                  if (res.ok) router.refresh();
                })
              }
            >
              Delete template
            </Button>
          ) : null}
        </div>
      ) : null}
      <div aria-live="polite">{result && !result.ok && result.message ? <Alert tone="danger">{result.message}</Alert> : null}</div>
    </div>
  );
}

export function NewTemplateForm() {
  const router = useRouter();
  const uid = useId();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors },
  } = useForm<NewInput, unknown, z.output<typeof newTemplateSchema>>({ resolver: zodResolver(newTemplateSchema), defaultValues: { name: "", audience: "candidate" } });

  // The server re-parses the raw input with the same schema.
  const onSubmit = () =>
    startTransition(async () => {
      setMessage(undefined);
      const res = await createTemplate(getValues());
      for (const [field, msgs] of Object.entries(res.fieldErrors ?? {})) if (msgs?.[0]) setError(field as keyof NewInput, { message: msgs[0] });
      if (res.ok && res.id) router.push(`/admin/marketing/emails/templates/${res.id}`);
      else setMessage(res.message);
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <Field id={`${uid}-name`} label="Name" required error={errors.name?.message} hint="Only your team sees this name.">
          <Input
            id={`${uid}-name`}
            maxLength={120}
            placeholder="e.g. Marketing Cloud demo reminder"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy(`${uid}-name`, errors.name?.message, true)}
            {...register("name")}
          />
        </Field>
        <Field id={`${uid}-audience`} label="Written for" error={errors.audience?.message}>
          <Select id={`${uid}-audience`} {...register("audience")}>
            <option value="candidate">Candidates</option>
            <option value="team">Your team (notifications)</option>
          </Select>
        </Field>
      </fieldset>
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
        {pending ? "Creating…" : "Create and edit"}
      </Button>
    </form>
  );
}
