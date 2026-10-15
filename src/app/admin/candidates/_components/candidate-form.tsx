"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCandidate, updateCandidateDetails, type DuplicateMatch } from "@/app/actions/candidates";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { candidateCreateSchema, type CandidateCreate, type CandidateCreateInput } from "@/lib/validation/candidates";

type Option = { value: string; label: string };

type TextKey =
  | "fullName"
  | "email"
  | "phone"
  | "company"
  | "jobTitle"
  | "city"
  | "country"
  | "totalExperienceYears"
  | "relevantExperienceYears"
  | "preferredSchedule"
  | "preferredDeliveryMode"
  | "employmentStatus"
  | "heardAbout"
  | "source"
  | "utmSource"
  | "utmMedium"
  | "utmCampaign";

export type CandidateFormValues = Omit<CandidateCreateInput, "marketingConsent" | "privacyConsent" | "doNotContact"> & {
  marketingConsent: boolean;
  privacyConsent: boolean;
  doNotContact: boolean;
};

export const EMPTY_CANDIDATE: CandidateFormValues = {
  fullName: "",
  email: "",
  phone: "",
  company: "",
  jobTitle: "",
  city: "",
  country: "",
  totalExperienceYears: "",
  relevantExperienceYears: "",
  skills: "",
  interests: "",
  learningObjectives: "",
  preferredSchedule: "",
  preferredDeliveryMode: "",
  employmentStatus: "",
  heardAbout: "",
  source: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  marketingConsent: false,
  privacyConsent: false,
  doNotContact: false,
  leadStatusId: "",
  ownerId: "",
  courseId: "",
};

export function CandidateForm({
  mode,
  candidateId,
  initial,
  statuses = [],
  owners = [],
  courses = [],
  ownerLocked,
  onSaved,
}: {
  mode: "create" | "edit";
  candidateId?: string;
  initial: CandidateFormValues;
  statuses?: Option[];
  owners?: Option[];
  courses?: Option[];
  /** Set when the user can only own what they create (shown, not editable). */
  ownerLocked?: string;
  onSaved?: () => void;
}) {
  const [result, setResult] = useState<{ ok: boolean; message?: string; duplicates?: DuplicateMatch[] }>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<CandidateFormValues, unknown, CandidateCreate>({
    resolver: zodResolver(candidateCreateSchema) as never,
    defaultValues: initial,
  });

  const onSubmit = (values: CandidateCreate) => {
    setResult(undefined);
    startTransition(async () => {
      const res = mode === "create" ? await createCandidate(values) : await updateCandidateDetails(candidateId!, values);
      setResult(res);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as keyof CandidateFormValues, { message: messages[0] });
      }
      if (res.ok) {
        reset(undefined, { keepValues: true });
        onSaved?.();
      }
    });
  };

  const text = (name: TextKey, label: string, opts: { type?: string; hint?: string; placeholder?: string; required?: boolean; autoComplete?: string; inputMode?: "decimal" } = {}) => {
    const error = errors[name]?.message;
    return (
      <Field id={`cf-${name}`} label={label} error={error} hint={opts.hint} required={opts.required}>
        <Input
          id={`cf-${name}`}
          type={opts.type ?? "text"}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete ?? "off"}
          inputMode={opts.inputMode}
          aria-invalid={Boolean(error)}
          aria-required={opts.required}
          aria-describedby={describedBy(`cf-${name}`, error, opts.hint)}
          {...register(name)}
        />
      </Field>
    );
  };

  const area = (name: "skills" | "interests" | "learningObjectives", label: string) => {
    const error = errors[name]?.message;
    return (
      <Field id={`cf-${name}`} label={label} error={error} className="sm:col-span-2">
        <Textarea id={`cf-${name}`} rows={3} aria-invalid={Boolean(error)} aria-describedby={describedBy(`cf-${name}`, error)} {...register(name)} />
      </Field>
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6" noValidate>
      {result?.message ? (
        <Alert tone={result.ok ? "success" : result.duplicates?.length ? "warning" : "danger"} title={result.duplicates?.length ? "Possible duplicate" : undefined}>
          <p>{result.message}</p>
          {result.duplicates?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {result.duplicates.map((d) => (
                <li key={d.candidateId}>
                  {d.canView ? (
                    <Link href={`/admin/candidates/${d.candidateId}`} className="font-medium underline underline-offset-2">
                      Open {d.fullName ?? "the existing candidate"}
                    </Link>
                  ) : (
                    <span>A candidate assigned to someone else</span>
                  )}{" "}
                  (same {d.matchedOn})
                  {!d.canView ? <span className="block text-xs">Ask an administrator to assign it to you.</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-fg">Contact</legend>
        <div className="sm:col-span-2">{text("fullName", "Full name", { required: true, autoComplete: "name" })}</div>
        {text("email", "Email", { type: "email", hint: "Email or phone is required.", autoComplete: "email" })}
        {text("phone", "Phone", { type: "tel", placeholder: "+91 98765 43210", autoComplete: "tel" })}
        {text("company", "Company", { autoComplete: "organization" })}
        {text("jobTitle", "Job title", { autoComplete: "organization-title" })}
        {text("city", "City")}
        {text("country", "Country")}
      </fieldset>

      {mode === "create" ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-fg">Pipeline</legend>
          <Field id="cf-leadStatusId" label="Lead status" error={errors.leadStatusId?.message}>
            <Select id="cf-leadStatusId" {...register("leadStatusId")}>
              <option value="">New (default)</option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </Field>
          {ownerLocked ? (
            <Field id="cf-owner-locked" label="Owner" hint="Candidates you add are assigned to you.">
              <Input id="cf-owner-locked" value={ownerLocked} disabled aria-describedby="cf-owner-locked-hint" readOnly />
            </Field>
          ) : (
            <Field id="cf-ownerId" label="Owner" error={errors.ownerId?.message}>
              <Select id="cf-ownerId" aria-invalid={Boolean(errors.ownerId)} {...register("ownerId")}>
                <option value="">Unassigned</option>
                {owners.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
          )}
          {courses.length ? (
            <Field id="cf-courseId" label="Interested in course" hint="Optional. Adds a registration to their record." className="sm:col-span-2">
              <Select id="cf-courseId" aria-describedby="cf-courseId-hint" {...register("courseId")}>
                <option value="">No course yet</option>
                {courses.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </Select>
            </Field>
          ) : null}
        </fieldset>
      ) : null}

      <details className="group rounded-lg border border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          Background and attribution
          <span aria-hidden className="text-muted transition group-open:rotate-90">›</span>
        </summary>
        <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
          {text("totalExperienceYears", "Total experience (years)", { inputMode: "decimal" })}
          {text("relevantExperienceYears", "Relevant experience (years)", { inputMode: "decimal" })}
          {text("employmentStatus", "Employment status")}
          {text("preferredSchedule", "Preferred schedule")}
          {text("preferredDeliveryMode", "Preferred delivery mode")}
          {text("heardAbout", "Heard about us via")}
          {area("skills", "Skills")}
          {area("interests", "Interests")}
          {area("learningObjectives", "Learning objectives")}
          {text("source", "Source", { placeholder: mode === "create" ? "manual" : undefined })}
          {text("utmSource", "UTM source")}
          {text("utmMedium", "UTM medium")}
          {text("utmCampaign", "UTM campaign")}
        </div>
      </details>

      <fieldset className="grid gap-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Consent</legend>
        <Checkbox id="cf-privacyConsent" label="Privacy policy accepted" description="Tick only if the candidate agreed to the privacy policy. The date is recorded." {...register("privacyConsent")} />
        <Checkbox id="cf-marketingConsent" label="Agreed to marketing messages" description="Email, phone or WhatsApp updates about courses." {...register("marketingConsent")} />
        <Checkbox id="cf-doNotContact" label="Do not contact" description="Overrides marketing consent; the candidate asked not to be contacted." {...register("doNotContact")} />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || (mode === "edit" && !isDirty)} aria-busy={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create candidate" : "Save details"}
        </Button>
        {mode === "create" ? (
          <Link href="/admin/candidates" className="inline-flex h-9 items-center px-3 text-sm text-brand-600 hover:underline">Cancel</Link>
        ) : null}
      </div>
    </form>
  );
}
