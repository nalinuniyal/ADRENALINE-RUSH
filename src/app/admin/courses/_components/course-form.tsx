"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, ListPlus, Plus, Trash2, Wand2 } from "lucide-react";
import { createCourse, updateCourse } from "@/app/actions/courses";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { InclusionIcon } from "@/components/public/inclusion-icon";
import { DELIVERY_MODES } from "@/lib/format";
import {
  courseSchema,
  INCLUSION_ICONS,
  MAX_FAQS,
  MAX_INCLUSIONS,
  mergeSuggestedInclusions,
  toSlug,
  type CourseFormInput,
  type CourseFormOutput,
} from "@/lib/validation/courses";

type TextName = Exclude<
  FieldPath<CourseFormInput>,
  "showPrice" | "faqs" | `faqs.${string}` | "inclusions" | `inclusions.${string}` | "deliveryMode" | "categoryId" | "registrationMode"
>;

const LEVELS = ["Beginner", "Intermediate", "Advanced", "All levels"];

export function CourseForm({
  courseId,
  initial,
  categories,
  readOnly = false,
}: {
  /** Absent when creating a course. */
  courseId?: string;
  initial: CourseFormInput;
  categories: { id: string; name: string }[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const isNew = !courseId;
  const [result, setResult] = useState<{ ok: boolean; message?: string }>();
  const [pending, startTransition] = useTransition();
  const [slugEdited, setSlugEdited] = useState(!isNew);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<CourseFormInput, unknown, CourseFormOutput>({ resolver: zodResolver(courseSchema), defaultValues: initial });
  const faqs = useFieldArray({ control, name: "faqs" });
  const inclusions = useFieldArray({ control, name: "inclusions" });
  const slug = useWatch({ control, name: "slug" });
  const registrationMode = useWatch({ control, name: "registrationMode" });
  const inclusionValues = useWatch({ control, name: "inclusions" });

  const addSuggested = () => {
    const current = getValues("inclusions") ?? [];
    const additions = mergeSuggestedInclusions(current).slice(current.length);
    if (additions.length) inclusions.append(additions, { shouldFocus: false });
  };

  const titleField = register("title", {
    onChange: (e: { target: { value: string } }) => {
      if (!slugEdited) setValue("slug", toSlug(e.target.value), { shouldDirty: true });
    },
  });
  const slugField = register("slug", { onChange: () => setSlugEdited(true) });

  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      // Send the raw form input: the server parses it with the same schema, and
      // parsing already-transformed output (nulls, arrays) would fail.
      const raw = getValues();
      const res = isNew ? await createCourse(raw) : await updateCourse(courseId, raw);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as FieldPath<CourseFormInput>, { message: messages[0] });
      }
      if (res.ok && isNew && res.id) {
        router.push(`/admin/courses/${res.id}?created=1`);
        return;
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
    opts: { type?: string; hint?: ReactNode; placeholder?: string; required?: boolean; multiline?: number; maxLength?: number; inputMode?: "decimal" | "numeric"; list?: string; className?: string } = {},
  ) => {
    const error = errors[name]?.message;
    const common = {
      id: name,
      placeholder: opts.placeholder,
      maxLength: opts.maxLength,
      "aria-invalid": Boolean(error),
      "aria-required": opts.required || undefined,
      "aria-describedby": describedBy(name, error, opts.hint),
    };
    const field = name === "title" ? titleField : name === "slug" ? slugField : register(name);
    return (
      <Field id={name} label={label} error={error} hint={opts.hint} required={opts.required} className={opts.className}>
        {opts.multiline ? (
          <Textarea rows={opts.multiline} {...common} {...field} />
        ) : (
          <Input type={opts.type ?? "text"} inputMode={opts.inputMode} list={opts.list} {...common} {...field} />
        )}
      </Field>
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate aria-label={isNew ? "New course" : "Course details"}>
      <fieldset disabled={readOnly || pending} className="grid min-w-0 gap-6">
        {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}

        <Section title="Basics" description="What people see first on the course list and page.">
          {text("title", "Course title", { required: true, maxLength: 140, className: "sm:col-span-2" })}
          <Field
            id="slug"
            label="URL slug"
            required
            error={errors.slug?.message}
            hint={<>Public link: /courses/{slug || "…"}{!isNew ? " · Changing it breaks links you have already shared." : null}</>}
            className="sm:col-span-2"
          >
            <div className="flex gap-2">
              <Input
                id="slug"
                maxLength={80}
                autoCapitalize="none"
                spellCheck={false}
                aria-required
                aria-invalid={Boolean(errors.slug)}
                aria-describedby={describedBy("slug", errors.slug?.message, true)}
                {...slugField}
              />
              {!readOnly ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setValue("slug", toSlug(getValues("title") ?? ""), { shouldDirty: true, shouldValidate: true });
                    setSlugEdited(isNew ? false : true);
                  }}
                  aria-label="Generate slug from title"
                  title="Generate from title"
                >
                  <Wand2 className="size-4" aria-hidden /> <span className="hidden sm:inline">From title</span>
                </Button>
              ) : null}
            </div>
          </Field>
          <Field id="categoryId" label="Category" error={errors.categoryId?.message} hint={categories.length ? undefined : "No categories yet. Add them under Courses › Categories."}>
            <Select id="categoryId" aria-describedby={describedBy("categoryId", errors.categoryId?.message, !categories.length)} {...register("categoryId")}>
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="deliveryMode" label="Delivery mode" required error={errors.deliveryMode?.message}>
            <Select id="deliveryMode" aria-invalid={Boolean(errors.deliveryMode)} {...register("deliveryMode")}>
              {DELIVERY_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {text("shortDescription", "Short description", { multiline: 2, maxLength: 300, hint: "Up to 300 characters. Shown on course cards.", className: "sm:col-span-2" })}
          {text("coverImageUrl", "Cover image URL", { type: "url", placeholder: "https://", hint: "Optional. Must start with https://", className: "sm:col-span-2" })}
        </Section>

        <Section title="Course content" description="The main sections of the public course page.">
          {text("description", "Overview", { multiline: 6, maxLength: 20000, className: "sm:col-span-2" })}
          {text("whoIsItFor", "Who it is for", { multiline: 3, maxLength: 4000, className: "sm:col-span-2" })}
          {text("learningOutcomes", "Learning outcomes", { multiline: 5, hint: "One outcome per line (up to 30).", className: "sm:col-span-2" })}
          {text("prerequisites", "Prerequisites", { multiline: 3, maxLength: 4000, className: "sm:col-span-2" })}
          {text("instructorName", "Trainer", { maxLength: 120 })}
          {text("level", "Level", { maxLength: 40, list: "course-levels", placeholder: "e.g. Beginner" })}
          <datalist id="course-levels">
            {LEVELS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          {text("durationText", "Duration", { maxLength: 80, placeholder: "e.g. 8 weeks · 48 hours" })}
          {text("certificateDetails", "Certificate details", { multiline: 2, maxLength: 2000 })}
        </Section>

        <Section title="Pricing and enrolment">
          {text("listPrice", "List price", { inputMode: "decimal", placeholder: "e.g. 24999", hint: "Leave empty for “Contact for fees”." })}
          {text("discountedPrice", "Discounted price", { inputMode: "decimal", hint: "Optional. Cannot exceed the list price." })}
          {text("currency", "Currency", { maxLength: 3, required: true, hint: "3-letter ISO code, e.g. INR" })}
          {text("capacity", "Capacity", { inputMode: "numeric", hint: "Optional. Seats per batch." })}
          <div className="sm:col-span-2">
            <Checkbox id="showPrice" label="Show price on the public page" description="When off, the page says “Contact for fees”." {...register("showPrice")} />
          </div>
          {text("enrollmentOpensOn", "Registration opens", { type: "date", hint: "Optional. Leave empty to open on publish." })}
          {text("enrollmentClosesOn", "Registration closes", { type: "date", hint: "Optional." })}
        </Section>

        <Section title="Registration experience" description="How candidates sign up from the course page.">
          <Field
            id="registrationMode"
            label="Registration type"
            required
            error={errors.registrationMode?.message}
            hint={registrationMode === "interest" ? "A simple “register your interest” form." : "Candidates book a free demo class; you see them as demo requests."}
          >
            <Select id="registrationMode" aria-describedby="registrationMode-hint" {...register("registrationMode")}>
              <option value="demo">Free demo booking</option>
              <option value="interest">Register interest</option>
            </Select>
          </Field>
          {text("ctaLabel", "Button label", {
            maxLength: 40,
            placeholder: registrationMode === "interest" ? "Register now" : "Book a free demo",
            hint: "Optional. Leave empty for the default shown.",
          })}
          {text("highlightBadge", "Highlight badge", {
            maxLength: 80,
            placeholder: "e.g. Next demo: Saturday 11 AM",
            hint: "Optional. A short note shown at the top of the course page.",
            className: "sm:col-span-2",
          })}
          {text("demoUrl", "Demo video or page URL", { type: "url", placeholder: "https://", hint: "Optional. Adds a “Watch demo” button.", className: "sm:col-span-2" })}
          {text("successMessage", "Message after registering", { multiline: 2, maxLength: 1000, hint: "Shown on the thank-you page.", className: "sm:col-span-2" })}
        </Section>

        <Section title="What's included" description="Benefits shown as an icon grid on the course page, e.g. interview practice or one-to-one support. Hidden when empty." grid={false}>
          {inclusions.fields.length === 0 ? <p className="text-sm text-muted">Nothing listed yet.</p> : null}
          <ol className="grid gap-3">
            {inclusions.fields.map((row, i) => {
              const tErr = errors.inclusions?.[i]?.title?.message;
              const dErr = errors.inclusions?.[i]?.description?.message;
              const iErr = errors.inclusions?.[i]?.icon?.message;
              return (
                <li key={row.id} className="grid gap-3 rounded-lg border border-line bg-canvas/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-semibold text-muted">
                      <span className="flex size-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                        <InclusionIcon name={inclusionValues?.[i]?.icon} className="size-4" />
                      </span>
                      Item {i + 1}
                    </span>
                    {!readOnly ? (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="xs" onClick={() => inclusions.move(i, i - 1)} disabled={i === 0} aria-label={`Move item ${i + 1} up`}>
                          <ArrowUp className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => inclusions.move(i, i + 1)}
                          disabled={i === inclusions.fields.length - 1}
                          aria-label={`Move item ${i + 1} down`}
                        >
                          <ArrowDown className="size-3.5" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => inclusions.remove(i)} aria-label={`Remove item ${i + 1}`}>
                          <Trash2 className="size-3.5" aria-hidden /> Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
                    <Field id={`inc-${i}-title`} label="Title" error={tErr}>
                      <Input id={`inc-${i}-title`} maxLength={80} aria-invalid={Boolean(tErr)} aria-describedby={describedBy(`inc-${i}-title`, tErr)} {...register(`inclusions.${i}.title`)} />
                    </Field>
                    <Field id={`inc-${i}-icon`} label="Icon" error={iErr}>
                      <Select id={`inc-${i}-icon`} aria-invalid={Boolean(iErr)} aria-describedby={describedBy(`inc-${i}-icon`, iErr)} {...register(`inclusions.${i}.icon`)}>
                        <option value="">Default (check mark)</option>
                        {INCLUSION_ICONS.map((ic) => (
                          <option key={ic.value} value={ic.value}>
                            {ic.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field id={`inc-${i}-desc`} label="Short description" error={dErr} hint="Optional. One sentence.">
                    <Input
                      id={`inc-${i}-desc`}
                      maxLength={300}
                      aria-invalid={Boolean(dErr)}
                      aria-describedby={describedBy(`inc-${i}-desc`, dErr, true)}
                      {...register(`inclusions.${i}.description`)}
                    />
                  </Field>
                </li>
              );
            })}
          </ol>
          {errors.inclusions?.message ? <p className="text-xs font-medium text-danger-700">{errors.inclusions.message}</p> : null}
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              {inclusions.fields.length < MAX_INCLUSIONS ? (
                <Button variant="secondary" size="sm" onClick={() => inclusions.append({ title: "", description: "", icon: "" }, { shouldFocus: true })}>
                  <Plus className="size-4" aria-hidden /> Add item
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={addSuggested} disabled={inclusions.fields.length >= MAX_INCLUSIONS}>
                <ListPlus className="size-4" aria-hidden /> Add suggested items
              </Button>
              <span className="self-center text-xs text-muted">Suggestions are added to the list for you to edit; nothing is saved until you save the course.</span>
            </div>
          ) : null}
        </Section>

        <Section title="FAQs" description="Questions and answers shown at the bottom of the course page." grid={false}>
          {faqs.fields.length === 0 ? <p className="text-sm text-muted">No FAQs yet.</p> : null}
          <ol className="grid gap-3">
            {faqs.fields.map((row, i) => {
              const qErr = errors.faqs?.[i]?.q?.message;
              const aErr = errors.faqs?.[i]?.a?.message;
              return (
                <li key={row.id} className="grid gap-3 rounded-lg border border-line bg-canvas/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted">FAQ {i + 1}</span>
                    {!readOnly ? (
                      <Button variant="ghost" size="xs" onClick={() => faqs.remove(i)} aria-label={`Remove FAQ ${i + 1}`}>
                        <Trash2 className="size-3.5" aria-hidden /> Remove
                      </Button>
                    ) : null}
                  </div>
                  <Field id={`faq-${i}-q`} label="Question" error={qErr}>
                    <Input id={`faq-${i}-q`} maxLength={300} aria-invalid={Boolean(qErr)} aria-describedby={describedBy(`faq-${i}-q`, qErr)} {...register(`faqs.${i}.q`)} />
                  </Field>
                  <Field id={`faq-${i}-a`} label="Answer" error={aErr}>
                    <Textarea id={`faq-${i}-a`} rows={2} maxLength={3000} aria-invalid={Boolean(aErr)} aria-describedby={describedBy(`faq-${i}-a`, aErr)} {...register(`faqs.${i}.a`)} />
                  </Field>
                </li>
              );
            })}
          </ol>
          {errors.faqs?.message ? <p className="text-xs font-medium text-danger-700">{errors.faqs.message}</p> : null}
          {!readOnly && faqs.fields.length < MAX_FAQS ? (
            <div>
              <Button variant="secondary" size="sm" onClick={() => faqs.append({ q: "", a: "" }, { shouldFocus: true })}>
                <Plus className="size-4" aria-hidden /> Add FAQ
              </Button>
            </div>
          ) : null}
        </Section>

        {!readOnly ? (
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
            <Button type="submit" disabled={pending || (!isNew && !isDirty)} aria-busy={pending}>
              {pending ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                  Saving…
                </>
              ) : isNew ? (
                "Create course"
              ) : (
                "Save changes"
              )}
            </Button>
            {!isNew && isDirty ? <span className="text-xs text-muted">You have unsaved changes.</span> : null}
            {isNew ? <span className="text-xs text-muted">The course is saved as a draft. Publish it when ready.</span> : null}
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

function Section({ title, description, children, grid = true }: { title: string; description?: string; children: ReactNode; grid?: boolean }) {
  return (
    <section className="grid gap-4 border-t border-line pt-5 first:border-0 first:pt-0" aria-labelledby={`sec-${toSlug(title)}`}>
      <div>
        <h3 id={`sec-${toSlug(title)}`} className="text-sm font-bold text-fg">
          {title}
        </h3>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      <div className={grid ? "grid gap-4 sm:grid-cols-2" : "grid gap-3"}>{children}</div>
    </section>
  );
}
