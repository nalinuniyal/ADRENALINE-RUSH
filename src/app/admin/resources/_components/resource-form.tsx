"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Link2 } from "lucide-react";
import { createResource, updateResource } from "@/app/actions/resources";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { embedFor, linkHost } from "@/lib/resources/embed";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "@/lib/resources/types";
import { resourceSchema, type ResourceFormInput, type ResourceFormOutput } from "@/lib/validation/resources";

const PROVIDER_LABELS = { youtube: "YouTube", vimeo: "Vimeo", drive: "Google Drive", loom: "Loom" } as const;

export function ResourceForm({
  resourceId,
  initial,
  courses,
  readOnly = false,
}: {
  /** Absent when creating a resource. */
  resourceId?: string;
  initial: ResourceFormInput;
  courses: { id: string; title: string; status: string }[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const isNew = !resourceId;
  const [result, setResult] = useState<{ ok: boolean; message?: string }>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    control,
    reset,
    formState: { errors },
  } = useForm<ResourceFormInput, unknown, ResourceFormOutput>({ resolver: zodResolver(resourceSchema), defaultValues: initial });
  const url = useWatch({ control, name: "url" });
  const visibility = useWatch({ control, name: "visibility" });
  const embed = embedFor(url);
  const host = linkHost(url);

  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      // Raw form input: the server parses it with the same schema.
      const raw = getValues();
      const res = isNew ? await createResource(raw) : await updateResource(resourceId, raw);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as FieldPath<ResourceFormInput>, { message: messages[0] });
      }
      if (res.ok && isNew && res.id) {
        router.push(`/admin/resources/${res.id}?created=1`);
        return;
      }
      setResult(res);
      if (res.ok) {
        reset(getValues());
        router.refresh();
      }
    });
  };

  const err = (name: FieldPath<ResourceFormInput>) => {
    const e = name.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), errors) as { message?: string } | undefined;
    return e?.message;
  };

  return (
    <form onSubmit={handleSubmit(onSubmit, () => setResult({ ok: false, message: "Please fix the highlighted fields." }))} noValidate aria-label={isNew ? "New resource" : "Resource details"}>
      <fieldset disabled={readOnly || pending} className="grid min-w-0 gap-5">
        {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="title" label="Title" required error={err("title")} className="sm:col-span-2">
            <Input id="title" maxLength={160} aria-invalid={Boolean(err("title"))} aria-describedby={describedBy("title", err("title"))} {...register("title")} />
          </Field>
          <Field id="type" label="Type" required error={err("type")}>
            <Select id="type" {...register("type")}>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RESOURCE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="expiresOn" label="Expires on (optional)" error={err("expiresOn")} hint="After this date it can no longer be shared and its public page stops working.">
            <Input id="expiresOn" type="date" aria-describedby={describedBy("expiresOn", err("expiresOn"), true)} {...register("expiresOn")} />
          </Field>
          <Field
            id="url"
            label="Link"
            required
            error={err("url")}
            className="sm:col-span-2"
            hint={
              embed ? (
                <span className="inline-flex items-center gap-1 text-success-700">
                  <CheckCircle2 className="size-3.5" aria-hidden /> {PROVIDER_LABELS[embed.provider]} video: it will play inside the public page.
                </span>
              ) : host ? (
                <span className="inline-flex items-center gap-1">
                  <Link2 className="size-3.5" aria-hidden /> {host}: shown as a button on the public page.
                </span>
              ) : (
                "YouTube, Vimeo, Google Drive, GitHub or any https link. Make sure the people you share it with are allowed to open it (for Google Drive: “Anyone with the link”)."
              )
            }
          >
            <Input id="url" type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" maxLength={1000} aria-invalid={Boolean(err("url"))} aria-describedby={describedBy("url", err("url"), true)} {...register("url")} />
          </Field>
          <Field id="description" label="Description (optional)" error={err("description")} className="sm:col-span-2" hint="Shown on the public page.">
            <Textarea id="description" rows={4} maxLength={4000} aria-describedby={describedBy("description", err("description"), true)} {...register("description")} />
          </Field>
          <Field id="accessInstructions" label="Access instructions (optional)" error={err("accessInstructions")} className="sm:col-span-2" hint="For example a password or “Sign in with the email you registered with”. Shown on the public page.">
            <Textarea id="accessInstructions" rows={2} maxLength={1000} className="min-h-16" aria-describedby={describedBy("accessInstructions", err("accessInstructions"), true)} {...register("accessInstructions")} />
          </Field>
          <Field id="thumbnailUrl" label="Thumbnail image link (optional)" error={err("thumbnailUrl")} className="sm:col-span-2" hint="YouTube videos get their thumbnail automatically.">
            <Input id="thumbnailUrl" type="url" inputMode="url" placeholder="https://…" maxLength={1000} aria-describedby={describedBy("thumbnailUrl", err("thumbnailUrl"), true)} {...register("thumbnailUrl")} />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs font-medium text-[#444]">Who can see it</legend>
          <label className="flex items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50/60">
            <input type="radio" value="shareable" className="mt-0.5 size-4 accent-brand-600" {...register("visibility")} />
            <span className="text-sm">
              <span className="font-medium">Shareable</span>
              <span className="block text-muted">Can be sent to candidates and gets its own public page (not listed on the website or in search engines).</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50/60">
            <input type="radio" value="internal" className="mt-0.5 size-4 accent-brand-600" {...register("visibility")} />
            <span className="text-sm">
              <span className="font-medium">Internal only</span>
              <span className="block text-muted">Only your team sees it here. It cannot be shared and has no public page.</span>
            </span>
          </label>
          {visibility === "shareable" ? (
            <p className="text-xs text-muted">Sharing never changes who can open the original link. Private Drive or unlisted videos stay as private as you set them.</p>
          ) : null}
        </fieldset>

        <Checkbox id="isActive" label="Switched on" description="Switch off to hide it from sharing and its public page without deleting it." {...register("isActive")} />

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-[#444]">Courses (optional)</legend>
          {courses.length === 0 ? (
            <p className="text-sm text-muted">No courses yet.</p>
          ) : (
            <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-line p-3 sm:grid-cols-2">
              {courses.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" value={c.id} className="mt-0.5 size-4 accent-brand-600" {...register("courseIds")} />
                  <span>
                    {c.title}
                    {c.status !== "published" ? <span className="text-muted"> ({c.status})</span> : null}
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs text-muted">The public page shows published courses with a “Book a free demo” button.</p>
        </fieldset>

        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "Saving…" : isNew ? "Save resource" : "Save changes"}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
