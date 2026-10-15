"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { createAutomation, deleteAutomation, setAutomationActive, updateAutomation, type EmailActionResult } from "@/app/actions/email";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { IconTile } from "@/components/ui/icon-tile";
import { AUTOMATION_CHANNELS, AUTOMATION_RECIPIENTS, CHANNEL_LABELS, RECIPIENT_LABELS, type AutomationChannel, type AutomationRecipient } from "@/lib/email/automation-rules";
import { cn } from "@/lib/utils";
import { automationSchema, type AutomationFormInput, type AutomationFormOutput } from "@/lib/validation/email";

export type AutomationRow = {
  id: string;
  name: string;
  course_id: string | null;
  channel: string;
  recipient: string;
  custom_emails: string[];
  template_id: string;
  is_active: boolean;
};
type Option = { id: string; name: string; audience: string };
type CourseOption = { id: string; title: string };

export function AutomationManager({
  automations,
  templates,
  courses,
  canManage,
}: {
  automations: AutomationRow[];
  templates: Option[];
  courses: CourseOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<EmailActionResult>();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const templateName = new Map(templates.map((t) => [t.id, t.name]));
  const courseName = new Map(courses.map((c) => [c.id, c.title]));

  const done = (res: EmailActionResult) => {
    setResult(res);
    if (res.ok) router.refresh();
  };

  const blank: AutomationFormInput = {
    name: "",
    courseId: "",
    channel: "demo_request",
    recipient: "candidate",
    customEmails: "",
    templateId: templates[0]?.id ?? "",
    isActive: true,
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr] lg:items-start">
      <Card>
        <CardHeader icon={<IconTile icon={Zap} color="indigo" size="sm" />}>
          <CardTitle>Automations</CardTitle>
          <CardDescription>{automations.length ? `${automations.filter((a) => a.is_active).length} of ${automations.length} switched on` : "None yet"}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div aria-live="polite">{result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}</div>
          {automations.length === 0 ? (
            <EmptyState
              icon={<Zap className="size-6" aria-hidden />}
              title="No automations"
              description={canManage ? "Add one to email candidates or your team when someone books a demo." : "Nothing is sent automatically yet."}
            />
          ) : (
            <ul className="grid gap-3">
              {automations.map((a) => (
                <li key={a.id} className={cn("rounded-lg border border-line px-3 py-3", !a.is_active && "bg-canvas/60")}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold break-words">
                        {a.name}
                        <Badge tone={a.is_active ? "success" : "neutral"}>{a.is_active ? "On" : "Off"}</Badge>
                      </p>
                      <p className="mt-1 text-sm text-[#444]">
                        When: {CHANNEL_LABELS[a.channel as AutomationChannel] ?? a.channel} · {a.course_id ? (courseName.get(a.course_id) ?? "a course") : "All courses"}
                      </p>
                      <p className="flex flex-wrap items-center gap-1 text-sm text-[#444]">
                        <ArrowRight className="size-3.5 text-muted" aria-hidden /> Send{" "}
                        <Link href={`/admin/marketing/emails/templates/${a.template_id}`} className="font-medium text-brand-700 hover:underline">
                          {templateName.get(a.template_id) ?? "template"}
                        </Link>{" "}
                        to {a.recipient === "custom" ? a.custom_emails.join(", ") : (RECIPIENT_LABELS[a.recipient as AutomationRecipient] ?? a.recipient).toLowerCase()}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={a.is_active}
                          aria-label={`${a.name}: ${a.is_active ? "on" : "off"}`}
                          disabled={pending}
                          onClick={() => startTransition(async () => done(await setAutomationActive(a.id, !a.is_active)))}
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition disabled:opacity-50",
                            a.is_active ? "bg-success-700" : "bg-[#c9c7c5]",
                          )}
                        >
                          <span aria-hidden className={cn("inline-block size-5 rounded-full bg-white shadow transition", a.is_active ? "translate-x-5.5" : "translate-x-0.5")} />
                        </button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(editing === a.id ? null : a.id)} aria-expanded={editing === a.id} aria-label={`Edit ${a.name}`}>
                          <Pencil className="size-4" aria-hidden /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger-700 hover:bg-danger-50"
                          onClick={() => setConfirmDelete(confirmDelete === a.id ? null : a.id)}
                          aria-expanded={confirmDelete === a.id}
                          aria-label={`Delete ${a.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {confirmDelete === a.id ? (
                    <div role="group" aria-label={`Confirm deleting ${a.name}`} className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
                      <span className="flex-1">Delete “{a.name}”? Switching it off keeps it for later instead.</span>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const res = await deleteAutomation(a.id);
                            setConfirmDelete(null);
                            done(res);
                          })
                        }
                      >
                        Delete automation
                      </Button>
                    </div>
                  ) : null}
                  {editing === a.id ? (
                    <div className="mt-3 rounded-lg border border-line bg-canvas/40 p-3">
                      <AutomationForm
                        initial={{
                          name: a.name,
                          courseId: a.course_id ?? "",
                          channel: a.channel as AutomationChannel,
                          recipient: a.recipient as AutomationRecipient,
                          customEmails: a.custom_emails.join("\n"),
                          templateId: a.template_id,
                          isActive: a.is_active,
                        }}
                        templates={templates}
                        courses={courses}
                        submitLabel="Save automation"
                        save={(v) => updateAutomation(a.id, v)}
                        onDone={(res) => {
                          setEditing(null);
                          done(res);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader icon={<Plus className="size-5 text-brand-600" aria-hidden />}>
            <CardTitle>Add an automation</CardTitle>
            <CardDescription>E.g. a different confirmation for one course.</CardDescription>
          </CardHeader>
          <CardContent>
            {templates.length ? (
              <AutomationForm key={automations.length} initial={blank} templates={templates} courses={courses} submitLabel="Add automation" save={createAutomation} onDone={done} />
            ) : (
              <p className="text-sm text-muted">Create an email template first.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function AutomationForm({
  initial,
  templates,
  courses,
  submitLabel,
  save,
  onDone,
  onCancel,
}: {
  initial: AutomationFormInput;
  templates: Option[];
  courses: CourseOption[];
  submitLabel: string;
  save: (values: AutomationFormInput) => Promise<EmailActionResult>;
  onDone: (res: EmailActionResult) => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    control,
    formState: { errors },
  } = useForm<AutomationFormInput, unknown, AutomationFormOutput>({ resolver: zodResolver(automationSchema), defaultValues: initial });
  const recipient = useWatch({ control, name: "recipient" });
  const templateId = useWatch({ control, name: "templateId" });
  const chosen = templates.find((t) => t.id === templateId);
  const mismatch = chosen && ((recipient === "candidate" && chosen.audience === "team") || (recipient !== "candidate" && chosen.audience === "candidate"));

  // The server re-parses the raw input with the same schema.
  const onSubmit = () => {
    setMessage(undefined);
    startTransition(async () => {
      const res = await save(getValues());
      for (const [name, msgs] of Object.entries(res.fieldErrors ?? {})) if (msgs?.[0]) setError(name as keyof AutomationFormInput, { message: msgs[0] });
      if (res.ok) onDone(res);
      else setMessage(res.message);
    });
  };
  const err = (n: keyof AutomationFormInput) => errors[n]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <Field id={id("name")} label="Name" required error={err("name")}>
          <Input id={id("name")} maxLength={120} aria-invalid={Boolean(err("name"))} aria-describedby={describedBy(id("name"), err("name"))} {...register("name")} />
        </Field>
        <Field id={id("channel")} label="When" error={err("channel")}>
          <Select id={id("channel")} {...register("channel")}>
            {AUTOMATION_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={id("courseId")} label="For course" error={err("courseId")} hint="“All courses” includes courses you create later.">
          <Select id={id("courseId")} aria-describedby={describedBy(id("courseId"), err("courseId"), true)} {...register("courseId")}>
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={id("templateId")} label="Send template" required error={err("templateId")}>
          <Select id={id("templateId")} aria-invalid={Boolean(err("templateId"))} {...register("templateId")}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={id("recipient")} label="To" error={err("recipient")}>
          <Select id={id("recipient")} {...register("recipient")}>
            {AUTOMATION_RECIPIENTS.map((r) => (
              <option key={r} value={r}>
                {RECIPIENT_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        {recipient === "custom" ? (
          <Field id={id("customEmails")} label="Email addresses" required error={err("customEmails")} hint="One per line, up to 20.">
            <Textarea
              id={id("customEmails")}
              rows={3}
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(err("customEmails"))}
              aria-describedby={describedBy(id("customEmails"), err("customEmails"), true)}
              {...register("customEmails")}
            />
          </Field>
        ) : null}
        {recipient === "admins" ? <p className="text-xs text-muted">Team recipients are set under Emails → Settings.</p> : null}
        {mismatch ? (
          <Alert tone="warning">
            {recipient === "candidate"
              ? "This template is written for your team and may show the candidate's own answers. Choose a candidate template."
              : "This template is written for candidates. Team-only details (answers, dashboard link) are filled only in team templates."}
          </Alert>
        ) : null}
        <Checkbox id={id("isActive")} label="Switched on" description="When off, nothing is sent by this automation." {...register("isActive")} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
