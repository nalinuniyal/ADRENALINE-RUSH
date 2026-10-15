"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { updateOrganizationSettings } from "@/app/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, describedBy, Field, Input, Select } from "@/components/ui/field";
import { organizationSettingsSchema } from "@/lib/validation/settings";

type FormInput = z.input<typeof organizationSettingsSchema>;
type FormOutput = z.output<typeof organizationSettingsSchema>;

const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

export function OrganizationSettingsForm({ initial }: { initial: FormInput }) {
  const [result, setResult] = useState<{ ok: boolean; message?: string }>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
    reset,
  } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(organizationSettingsSchema), defaultValues: initial });

  const timezones = COMMON_TIMEZONES.includes(initial.timezone) ? COMMON_TIMEZONES : [initial.timezone, ...COMMON_TIMEZONES];

  const onSubmit = (values: FormOutput) => {
    setResult(undefined);
    startTransition(async () => {
      const res = await updateOrganizationSettings(values);
      setResult(res);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as keyof FormInput, { message: messages[0] });
      }
      if (res.ok) reset(values as FormInput);
    });
  };

  const text = (name: "name" | "contactEmail" | "contactPhone" | "websiteUrl" | "logoUrl", label: string, opts: { type?: string; hint?: string; placeholder?: string } = {}) => {
    const error = errors[name]?.message;
    return (
      <Field id={name} label={label} error={error} hint={opts.hint}>
        <Input
          id={name}
          type={opts.type ?? "text"}
          placeholder={opts.placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(name, error, opts.hint)}
          {...register(name)}
        />
      </Field>
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
      {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {text("name", "Business name")}
        {text("contactEmail", "Contact email", { type: "email" })}
        {text("contactPhone", "Contact phone", { type: "tel", placeholder: "+91 98765 43210" })}
        {text("websiteUrl", "Website", { type: "url", placeholder: "https://" })}
        {text("logoUrl", "Logo URL", { type: "url", hint: "Optional. Upload support arrives with the resource library." })}
        <Field id="timezone" label="Time zone" error={errors.timezone?.message} hint="Sessions and reports use this time zone.">
          <Select id="timezone" {...register("timezone")} aria-describedby="timezone-hint">
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="defaultCurrency" label="Default currency" error={errors.defaultCurrency?.message} hint="ISO code. Amounts always store their own currency.">
          <Input id="defaultCurrency" maxLength={3} className="uppercase" aria-describedby={describedBy("defaultCurrency", errors.defaultCurrency?.message, true)} {...register("defaultCurrency")} />
        </Field>
      </div>
      <fieldset className="grid gap-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-medium">Team roles</legend>
        <Checkbox id="staffEnabled" label="Enable staff / counselor accounts" description="When off, staff members cannot sign in to the dashboard." {...register("staffEnabled")} />
        <Checkbox id="instructorsEnabled" label="Enable instructor accounts" description="When off, instructors cannot sign in to the dashboard." {...register("instructorsEnabled")} />
      </fieldset>
      <div>
        <Button type="submit" disabled={pending || !isDirty} aria-busy={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
