"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateSiteSettings } from "@/app/actions/site-settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { siteSettingsSchema, type SiteSettingsInput, type SiteSettingsOutput } from "@/lib/validation/site-settings";

type TextName = Exclude<FieldPath<SiteSettingsInput>, "showCourseCatalog" | "featuredCourseId">;

export function WebsiteSettingsForm({ initial, courses }: { initial: SiteSettingsInput; courses: { id: string; title: string; published: boolean }[] }) {
  const router = useRouter();
  const [result, setResult] = useState<{ ok: boolean; message?: string }>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    reset,
    formState: { errors, isDirty },
  } = useForm<SiteSettingsInput, unknown, SiteSettingsOutput>({ resolver: zodResolver(siteSettingsSchema), defaultValues: initial });

  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      // Send the raw form input: the server parses it with the same schema.
      const raw = getValues();
      const res = await updateSiteSettings(raw);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as FieldPath<SiteSettingsInput>, { message: messages[0] });
      }
      setResult(res);
      if (res.ok) {
        reset(getValues());
        router.refresh();
      }
    });
  };

  const onInvalid = () => setResult({ ok: false, message: "Please fix the highlighted fields." });

  const text = (
    name: TextName,
    label: string,
    opts: { type?: string; hint?: ReactNode; placeholder?: string; multiline?: number; maxLength?: number; className?: string } = {},
  ) => {
    const error = errors[name]?.message;
    const common = {
      id: name,
      placeholder: opts.placeholder,
      maxLength: opts.maxLength,
      "aria-invalid": Boolean(error),
      "aria-describedby": describedBy(name, error, opts.hint),
    };
    return (
      <Field id={name} label={label} error={error} hint={opts.hint} className={opts.className}>
        {opts.multiline ? <Textarea rows={opts.multiline} {...common} {...register(name)} /> : <Input type={opts.type ?? "text"} {...common} {...register(name)} />}
      </Field>
    );
  };

  const featuredHint = courses.length
    ? "Optional. The home page button and card point to this course. Only shown while the course is published."
    : "No courses yet. Create one under Courses first.";

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate aria-label="Website settings">
      <fieldset disabled={pending} className="grid min-w-0 gap-6">
        {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}

        <Section title="Home page" description="The first thing visitors see. Leave a field empty to use the built-in text.">
          {text("heroBadge", "Badge above the headline", { maxLength: 80, placeholder: "Admissions open for upcoming batches" })}
          <Field id="featuredCourseId" label="Featured course" error={errors.featuredCourseId?.message} hint={featuredHint}>
            <Select id="featuredCourseId" aria-describedby={describedBy("featuredCourseId", errors.featuredCourseId?.message, true)} {...register("featuredCourseId")}>
              <option value="">None (show “Explore courses”)</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.published ? "" : " (draft, not shown yet)"}
                </option>
              ))}
            </Select>
          </Field>
          {text("heroTitle", "Headline", { maxLength: 140, placeholder: "Train for the roles the future is hiring for.", className: "sm:col-span-2" })}
          {text("heroSubtitle", "Sub-headline", { multiline: 2, maxLength: 400, className: "sm:col-span-2" })}
          {text("aboutText", "About your business", { multiline: 4, maxLength: 4000, hint: "Optional. A short introduction for your public pages.", className: "sm:col-span-2" })}
          <div className="sm:col-span-2">
            <Checkbox
              id="showCourseCatalog"
              label="Show the course catalogue links"
              description="Turn off while you run a single course: visitors go straight to the featured course instead of the course list."
              {...register("showCourseCatalog")}
            />
          </div>
        </Section>

        <Section title="Contact details" description="Shown in the Contact section and footer. Empty fields are hidden.">
          {text("contactEmail", "Email", { type: "email", maxLength: 254, placeholder: "hello@example.com" })}
          {text("contactPhone", "Phone", { type: "tel", maxLength: 32, placeholder: "+91 98765 43210" })}
          {text("whatsappNumber", "WhatsApp number", { type: "tel", maxLength: 32, placeholder: "+91 98765 43210", hint: "With country code. Visitors get a “Chat on WhatsApp” link." })}
          {text("address", "Address", { multiline: 2, maxLength: 500 })}
        </Section>

        <Section title="Social links" description="Full links starting with https://. Empty fields are hidden.">
          {text("linkedinUrl", "LinkedIn", { type: "url", placeholder: "https://www.linkedin.com/company/…" })}
          {text("instagramUrl", "Instagram", { type: "url", placeholder: "https://www.instagram.com/…" })}
          {text("youtubeUrl", "YouTube", { type: "url", placeholder: "https://www.youtube.com/@…" })}
          {text("xUrl", "X (Twitter)", { type: "url", placeholder: "https://x.com/…" })}
          {text("facebookUrl", "Facebook", { type: "url", placeholder: "https://www.facebook.com/…" })}
        </Section>

        <Section title="Footer">
          {text("footerTagline", "Footer tagline", { multiline: 2, maxLength: 300, placeholder: "Career-focused technology training with live cohorts and real projects.", className: "sm:col-span-2" })}
        </Section>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <Button type="submit" disabled={pending || !isDirty} aria-busy={pending}>
            {pending ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
          {isDirty ? <span className="text-xs text-muted">You have unsaved changes.</span> : null}
        </div>
      </fieldset>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = `sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className="grid gap-4 border-t border-line pt-5 first:border-0 first:pt-0" aria-labelledby={id}>
      <div>
        <h3 id={id} className="text-sm font-bold text-fg">
          {title}
        </h3>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
