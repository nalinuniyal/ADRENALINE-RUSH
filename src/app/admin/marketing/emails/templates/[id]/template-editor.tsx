"use client";

import { useDeferredValue, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Braces, ImagePlus, Monitor, Send, Smartphone, Trash2, Upload } from "lucide-react";
import { sendTestEmail, updateTemplate, uploadImage, type EmailActionResult } from "@/app/actions/email";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { renderEmail } from "@/lib/email/render";
import { EMAIL_VARIABLES, sampleVariables, unknownVariables } from "@/lib/email/variables";
import { cn } from "@/lib/utils";
import { templateSchema, type TemplateFormInput, type TemplateFormOutput } from "@/lib/validation/email";

type Name = FieldPath<TemplateFormInput>;
type TextName = Exclude<Name, "useCustomHtml" | "audience">;
/** Fields that accept {{variables}} from the helper. */
const INSERTABLE = new Set<string>(["subject", "preheader", "heading", "body", "buttonLabel", "buttonUrl", "footerText", "customHtml"]);

export function TemplateEditor({
  templateId,
  initial,
  readOnly,
  siteUrl,
  businessName,
  userEmail,
}: {
  templateId: string;
  initial: TemplateFormInput;
  readOnly: boolean;
  siteUrl: string;
  businessName: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<EmailActionResult>();
  const [testResult, setTestResult] = useState<EmailActionResult>();
  const [pending, startTransition] = useTransition();
  const [testing, startTest] = useTransition();
  const [uploading, startUpload] = useTransition();
  const [uploadMsg, setUploadMsg] = useState<EmailActionResult>();
  const [lastUpload, setLastUpload] = useState<string>();
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const htmlFileRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<TemplateFormInput, unknown, TemplateFormOutput>({ resolver: zodResolver(templateSchema), defaultValues: initial });

  const values = useWatch({ control }) as TemplateFormInput;
  const deferred = useDeferredValue(values);
  const audience = deferred.audience === "team" ? "team" : "candidate";

  const preview = useMemo(() => {
    const vars = sampleVariables(audience, { business_name: businessName });
    return renderEmail(
      {
        subject: deferred.subject ?? "",
        preheader: deferred.preheader,
        design: {
          header_image_url: deferred.headerImageUrl,
          heading: deferred.heading,
          body: deferred.body,
          button_label: deferred.buttonLabel,
          button_url: deferred.buttonUrl,
          footer_text: deferred.footerText,
          accent_color: deferred.accentColor,
        },
        custom_html: deferred.customHtml,
        use_custom_html: deferred.useCustomHtml,
      },
      vars,
      { siteUrl },
    );
  }, [deferred, audience, businessName, siteUrl]);

  const unknown = unknownVariables(values.subject, values.preheader, values.heading, values.body, values.buttonUrl, values.buttonLabel, values.footerText, values.customHtml);

  const applyErrors = (res: EmailActionResult) => {
    for (const [field, msgs] of Object.entries(res.fieldErrors ?? {})) if (msgs?.[0]) setError(field as Name, { message: msgs[0] });
  };

  // The server re-parses the raw input with the same schema.
  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      const raw = getValues();
      const res = await updateTemplate(templateId, raw);
      applyErrors(res);
      setResult(res);
      if (res.ok) {
        reset(raw);
        router.refresh();
      }
    });
  };

  const onTest = () => {
    setTestResult(undefined);
    startTest(async () => {
      const res = await sendTestEmail(templateId, getValues());
      applyErrors(res);
      setTestResult(res);
    });
  };

  const insertVariable = (name: string) => {
    const el = lastField.current;
    const token = `{{${name}}}`;
    const field = (el?.name && INSERTABLE.has(el.name) ? el.name : values.useCustomHtml ? "customHtml" : "body") as TextName;
    const current = String(getValues(field) ?? "");
    const start = el && el.name === field ? (el.selectionStart ?? current.length) : current.length;
    const end = el && el.name === field ? (el.selectionEnd ?? current.length) : current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setValue(field, next, { shouldDirty: true });
    requestAnimationFrame(() => {
      if (el && el.name === field) {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }
    });
  };

  const upload = (file: File | undefined, target: "header" | "html") => {
    if (!file) return;
    setUploadMsg(undefined);
    startUpload(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadImage(fd);
      setUploadMsg(res);
      if (res.ok && res.url && res.id) {
        if (target === "header") {
          setValue("headerImageUrl", res.url, { shouldDirty: true, shouldValidate: true });
          setValue("headerImageAssetId", res.id, { shouldDirty: true });
        } else {
          setLastUpload(res.url);
          const absolute = `${siteUrl.replace(/\/+$/, "")}${res.url}`;
          const current = getValues("customHtml") ?? "";
          setValue("customHtml", `${current}${current ? "\n" : ""}<img src="${absolute}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">`, { shouldDirty: true });
        }
      }
      if (fileRef.current) fileRef.current.value = "";
      if (htmlFileRef.current) htmlFileRef.current.value = "";
    });
  };

  const err = (n: Name) => (errors as Record<string, { message?: string } | undefined>)[n]?.message;

  const text = (name: TextName, label: string, opts: { hint?: ReactNode; required?: boolean; rows?: number; maxLength?: number; placeholder?: string; className?: string; mono?: boolean } = {}) => {
    const error = err(name);
    const common = {
      id: `tpl-${name}`,
      placeholder: opts.placeholder,
      maxLength: opts.maxLength,
      "aria-invalid": Boolean(error),
      "aria-required": opts.required || undefined,
      "aria-describedby": describedBy(`tpl-${name}`, error, opts.hint),
      ...register(name),
    };
    return (
      <Field id={`tpl-${name}`} label={label} error={error} hint={opts.hint} required={opts.required} className={opts.className}>
        {opts.rows ? <Textarea rows={opts.rows} className={cn(opts.mono && "font-mono text-xs")} spellCheck={!opts.mono} {...common} /> : <Input {...common} />}
      </Field>
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit, () => setResult({ ok: false, message: "Please fix the highlighted fields." }))}
      onFocusCapture={(e) => {
        const t = e.target;
        if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && INSERTABLE.has(t.name)) lastField.current = t;
      }}
      noValidate
      aria-label="Email template"
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start"
    >
      <div className="grid min-w-0 gap-4">
        <div aria-live="polite" className="grid gap-2">
          {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
          {readOnly ? <Alert tone="info">You can view this template. Editing needs the “manage marketing” permission.</Alert> : null}
        </div>
        <fieldset disabled={readOnly || pending} className="grid min-w-0 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
              <CardDescription>The subject and preview text appear in the inbox list.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {text("name", "Template name", { required: true, maxLength: 120, hint: "Only your team sees this." })}
              <Field id="tpl-audience" label="Written for" hint="Team emails can use the candidate's answers and dashboard link.">
                <Select id="tpl-audience" aria-describedby="tpl-audience-hint" {...register("audience")}>
                  <option value="candidate">Candidates</option>
                  <option value="team">Your team (notifications)</option>
                </Select>
              </Field>
              {text("subject", "Subject", { required: true, maxLength: 200, className: "sm:col-span-2" })}
              {text("preheader", "Preview text", { maxLength: 200, className: "sm:col-span-2", hint: "Short line shown after the subject in most inboxes." })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader icon={<Braces className="size-5 text-brand-600" aria-hidden />}>
              <CardTitle>Personalise</CardTitle>
              <CardDescription>Click a variable to insert it where your cursor is. Values are filled in for each recipient.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-1.5" aria-label="Variables">
                {EMAIL_VARIABLES.filter((v) => audience === "team" || !v.teamOnly).map((v) => (
                  <li key={v.name}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertVariable(v.name)}
                      title={v.label}
                      aria-label={`Insert ${v.label}`}
                      className="rounded-full border border-line-strong bg-surface px-2.5 py-1 font-mono text-xs text-brand-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
                    >
                      {`{{${v.name}}}`}
                    </button>
                  </li>
                ))}
              </ul>
              {unknown.length ? (
                <Alert tone="warning" className="mt-3">
                  Unknown variable{unknown.length === 1 ? "" : "s"}: {unknown.map((u) => `{{${u}}}`).join(", ")}. These are sent as blank text.
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Design</CardTitle>
              <CardDescription>Plain text: leave a blank line between paragraphs. Formatting, logo bar and button are added for you.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <span className="text-xs font-medium text-[#444]">Header image</span>
                {values.headerImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={values.headerImageUrl} alt="Header image preview" className="max-h-40 w-full rounded-md border border-line object-cover" />
                ) : (
                  <p className="text-xs text-muted">No header image. A banner 1200×400 px (shown at 600 px wide) works well.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" id="tpl-header-file" onChange={(e) => upload(e.target.files?.[0], "header")} />
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} aria-busy={uploading}>
                    <Upload className="size-4" aria-hidden /> {uploading ? "Uploading…" : "Upload image"}
                  </Button>
                  {values.headerImageUrl ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger-700 hover:bg-danger-50"
                      onClick={() => {
                        setValue("headerImageUrl", "", { shouldDirty: true });
                        setValue("headerImageAssetId", "", { shouldDirty: true });
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden /> Remove
                    </Button>
                  ) : null}
                </div>
                {text("headerImageUrl", "…or image URL", { maxLength: 500, placeholder: "https://…", hint: "PNG, JPEG, GIF or WebP, up to 2 MB." })}
                <div aria-live="polite">{uploadMsg?.message ? <Alert tone={uploadMsg.ok ? "success" : "danger"}>{uploadMsg.message}</Alert> : null}</div>
              </div>
              {text("heading", "Heading", { maxLength: 200 })}
              {text("body", "Message", { rows: 10, maxLength: 10000 })}
              <div className="grid gap-4 sm:grid-cols-2">
                {text("buttonLabel", "Button label", { maxLength: 60, placeholder: "e.g. View course details" })}
                {text("buttonUrl", "Button link", { maxLength: 500, placeholder: "{{course_url}}", hint: "A variable like {{course_url}} or a full link." })}
              </div>
              {text("footerText", "Footer", { rows: 3, maxLength: 1000 })}
              <Field id="tpl-accentColor" label="Accent colour" error={err("accentColor")} hint="Top bar and button colour.">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Pick accent colour"
                    value={/^#[0-9a-f]{6}$/i.test(values.accentColor ?? "") ? values.accentColor : "#0176d3"}
                    onChange={(e) => setValue("accentColor", e.target.value, { shouldDirty: true, shouldValidate: true })}
                    className="h-9 w-12 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
                  />
                  <Input id="tpl-accentColor" maxLength={7} className="max-w-32 font-mono" aria-invalid={Boolean(err("accentColor"))} aria-describedby={describedBy("tpl-accentColor", err("accentColor"), true)} {...register("accentColor")} />
                </div>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Advanced: custom HTML</CardTitle>
              <CardDescription>For a fully custom design. Scripts, forms and event handlers are removed before sending.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Checkbox id="tpl-useCustomHtml" label="Use my own HTML instead of the design above" {...register("useCustomHtml")} />
              {values.useCustomHtml ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const current = getValues("customHtml");
                        if (current?.trim() && !window.confirm("Replace your custom HTML with the HTML of the design above?")) return;
                        const html = renderEmail(
                          {
                            subject: getValues("subject") ?? "",
                            preheader: getValues("preheader"),
                            design: {
                              header_image_url: getValues("headerImageUrl"),
                              heading: getValues("heading"),
                              body: getValues("body"),
                              button_label: getValues("buttonLabel"),
                              button_url: getValues("buttonUrl"),
                              footer_text: getValues("footerText"),
                              accent_color: getValues("accentColor"),
                            },
                          },
                          // Keep the {{variables}} as placeholders in the generated HTML.
                          Object.fromEntries(EMAIL_VARIABLES.map((v) => [v.name, `{{${v.name}}}`])),
                          { siteUrl },
                        ).html;
                        setValue("customHtml", html, { shouldDirty: true });
                      }}
                    >
                      Start from the design above
                    </Button>
                    <input ref={htmlFileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" id="tpl-html-file" onChange={(e) => upload(e.target.files?.[0], "html")} />
                    <Button variant="secondary" size="sm" onClick={() => htmlFileRef.current?.click()} disabled={uploading}>
                      <ImagePlus className="size-4" aria-hidden /> Upload and insert image
                    </Button>
                  </div>
                  {lastUpload ? <p className="text-xs break-all text-muted">Last image: {`${siteUrl.replace(/\/+$/, "")}${lastUpload}`}</p> : null}
                  {text("customHtml", "HTML", { rows: 16, maxLength: 100000, mono: true, hint: "Variables work here too. Use absolute https:// links for images." })}
                </>
              ) : null}
            </CardContent>
          </Card>
        </fieldset>

        {!readOnly ? (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface/95 px-3 py-3 shadow-card backdrop-blur">
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "Saving…" : "Save template"}
            </Button>
            <Button variant="secondary" onClick={onTest} disabled={testing} aria-busy={testing} title={`Sends to ${userEmail}`}>
              <Send className="size-4" aria-hidden /> {testing ? "Sending…" : "Send test email to me"}
            </Button>
            <span className="text-xs text-muted">{isDirty ? "Unsaved changes" : "All changes saved"}</span>
            <div aria-live="polite" className="basis-full">
              {testResult?.message ? <Alert tone={testResult.ok ? "success" : "danger"}>{testResult.message}</Alert> : null}
            </div>
          </div>
        ) : null}
      </div>

      <Card className="min-w-0 xl:sticky xl:top-4">
        <CardHeader
          actions={
            <div role="group" aria-label="Preview width" className="flex rounded-md border border-line-strong">
              <button type="button" onClick={() => setWidth("desktop")} aria-pressed={width === "desktop"} className={cn("inline-flex h-8 items-center px-2", width === "desktop" ? "bg-brand-50 text-brand-700" : "text-muted")} aria-label="Desktop width">
                <Monitor className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={() => setWidth("mobile")} aria-pressed={width === "mobile"} className={cn("inline-flex h-8 items-center border-l border-line-strong px-2", width === "mobile" ? "bg-brand-50 text-brand-700" : "text-muted")} aria-label="Phone width">
                <Smartphone className="size-4" aria-hidden />
              </button>
            </div>
          }
        >
          <CardTitle>Live preview</CardTitle>
          <CardDescription>With example values for {audience === "team" ? "a team notification" : "a candidate"}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <dl className="grid gap-1 rounded-md bg-canvas px-3 py-2 text-xs">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">Subject</dt>
              <dd className="min-w-0 font-medium break-words">{preview.subject}</dd>
            </div>
          </dl>
          <div className="overflow-hidden rounded-md border border-line bg-[#f3f3f3]">
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className={cn("mx-auto block h-[70vh] min-h-[480px] w-full bg-white transition-[max-width]", width === "mobile" ? "max-w-[375px]" : "max-w-full")}
            />
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-brand-700">Plain-text version</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-canvas p-3 whitespace-pre-wrap">{preview.text}</pre>
          </details>
        </CardContent>
      </Card>
    </form>
  );
}
