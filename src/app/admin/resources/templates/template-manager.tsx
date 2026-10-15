"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import { createShareTemplate, deleteShareTemplate, updateShareTemplate, type ResourceActionResult } from "@/app/actions/resources";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, inputClass, Select } from "@/components/ui/field";
import { IconTile } from "@/components/ui/icon-tile";
import { renderShareMessage, sampleShareVariables, SHARE_VARIABLES, unknownShareVariables } from "@/lib/resources/message";
import { TEMPLATE_CHANNEL_LABELS, TEMPLATE_CHANNELS, type TemplateChannel } from "@/lib/resources/types";
import { cn } from "@/lib/utils";

type Template = { id: string; name: string; channel: string; subject: string | null; body: string };
type Draft = { name: string; channel: TemplateChannel; subject: string; body: string };

const STARTER: Draft = {
  name: "",
  channel: "any",
  subject: "Your {{course_title}} resources",
  body: "Hi {{first_name}},\n\nHere is what we talked about:\n{{resource_links}}\n\nCourse details: {{course_url}}\n\n{{sender_name}}, {{business_name}}",
};

export function TemplateManager({ templates, canManage, businessName }: { templates: Template[]; canManage: boolean; businessName: string }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [flash, setFlash] = useState<ResourceActionResult>();

  return (
    <div className="grid gap-4">
      {flash?.message ? <Alert tone={flash.ok ? "success" : "danger"}>{flash.message}</Alert> : null}
      {canManage && editing !== "new" ? (
        <div>
          <Button onClick={() => { setFlash(undefined); setEditing("new"); }}>
            <Plus className="size-4" aria-hidden /> New template
          </Button>
        </div>
      ) : null}
      {editing === "new" ? (
        <TemplateEditor draft={STARTER} businessName={businessName} onDone={(res) => { setEditing(null); setFlash(res); }} onCancel={() => setEditing(null)} />
      ) : null}
      {templates.length === 0 && editing !== "new" ? (
        <EmptyState
          icon={<MessageSquareText className="size-6" aria-hidden />}
          title="No message templates"
          description={canManage ? "Create a template to share demos faster. You can still write a message from scratch when sharing." : "Templates appear here once someone who manages resources creates them."}
        />
      ) : null}
      <ul className="grid gap-4 lg:grid-cols-2">
        {templates.map((t) => (
          <li key={t.id} className={editing === t.id ? "lg:col-span-2" : undefined}>
            {editing === t.id ? (
              <TemplateEditor
                templateId={t.id}
                draft={{ name: t.name, channel: (TEMPLATE_CHANNELS as readonly string[]).includes(t.channel) ? (t.channel as TemplateChannel) : "any", subject: t.subject ?? "", body: t.body }}
                businessName={businessName}
                onDone={(res) => { setEditing(null); setFlash(res); }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <TemplateCard template={t} canManage={canManage} onEdit={() => { setFlash(undefined); setEditing(t.id); }} onDeleted={setFlash} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TemplateCard({ template: t, canManage, onEdit, onDeleted }: { template: Template; canManage: boolean; onEdit: () => void; onDeleted: (r: ResourceActionResult) => void }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Card className="h-full">
      <CardHeader
        icon={<IconTile icon={MessageSquareText} color="orange" size="sm" />}
        actions={
          canManage ? (
            <>
              <Button size="xs" variant="secondary" onClick={onEdit}>
                <Pencil className="size-3.5" aria-hidden /> Edit<span className="sr-only"> {t.name}</span>
              </Button>
              <Button size="xs" variant="ghost" className="text-danger-700 hover:bg-danger-50" onClick={() => setConfirm(true)} aria-expanded={confirm}>
                <Trash2 className="size-3.5" aria-hidden /> <span className="sr-only">Delete {t.name}</span>
              </Button>
            </>
          ) : undefined
        }
      >
        <CardTitle>{t.name}</CardTitle>
        <CardDescription>
          <Badge tone={t.channel === "whatsapp" ? "success" : t.channel === "email" ? "brand" : "neutral"}>{TEMPLATE_CHANNEL_LABELS[t.channel as TemplateChannel] ?? t.channel}</Badge>
          {t.subject && t.channel !== "whatsapp" ? <span className="ml-2">Subject: {t.subject}</span> : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="line-clamp-6 text-sm whitespace-pre-line text-[#444]">{t.body}</p>
        {confirm ? (
          <div role="group" aria-label="Confirm delete" className="mt-3 rounded-lg border border-danger-700/25 bg-danger-50 p-3 text-sm text-danger-700">
            <p>Delete this template? Past shares keep its name.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteShareTemplate(t.id);
                    setConfirm(false);
                    onDeleted(res);
                    if (res.ok) router.refresh();
                  })
                }
              >
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TemplateEditor({
  templateId,
  draft,
  businessName,
  onDone,
  onCancel,
}: {
  templateId?: string;
  draft: Draft;
  businessName: string;
  onDone: (r: ResourceActionResult) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Draft>(draft);
  const [result, setResult] = useState<ResourceActionResult>();
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setValues((d) => ({ ...d, [k]: v }));
  const unknown = unknownShareVariables(values.body, values.subject);
  const sample = sampleShareVariables({ business_name: businessName || "Your business" });
  const fe = result?.fieldErrors ?? {};
  const prefix = templateId ?? "new";

  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) return set("body", `${values.body}${token}`);
    const start = el.selectionStart ?? values.body.length;
    const end = el.selectionEnd ?? start;
    const next = `${values.body.slice(0, start)}${token}${values.body.slice(end)}`;
    set("body", next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = () => {
    setResult(undefined);
    startTransition(async () => {
      const res = templateId ? await updateShareTemplate(templateId, values) : await createShareTemplate(values);
      if (res.ok) {
        onDone(res);
        router.refresh();
      } else setResult(res);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{templateId ? `Edit “${draft.name}”` : "New message template"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="grid gap-4 lg:grid-cols-2"
          aria-label={templateId ? "Edit message template" : "New message template"}
        >
          <fieldset disabled={pending} className="grid min-w-0 content-start gap-3">
            {result?.message ? <Alert tone="danger">{result.message}</Alert> : null}
            <Field id={`${prefix}-name`} label="Name" required error={fe.name?.[0]}>
              <Input id={`${prefix}-name`} value={values.name} maxLength={120} onChange={(e) => set("name", e.target.value)} aria-invalid={Boolean(fe.name)} />
            </Field>
            <Field id={`${prefix}-channel`} label="Written for">
              <Select id={`${prefix}-channel`} value={values.channel} onChange={(e) => set("channel", e.target.value as TemplateChannel)}>
                {TEMPLATE_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {TEMPLATE_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            {values.channel !== "whatsapp" ? (
              <Field id={`${prefix}-subject`} label="Email subject" error={fe.subject?.[0]} hint="Used when the message is sent by email.">
                <Input id={`${prefix}-subject`} value={values.subject} maxLength={200} onChange={(e) => set("subject", e.target.value)} />
              </Field>
            ) : null}
            <Field id={`${prefix}-body`} label="Message" required error={fe.body?.[0]} hint="Plain text. WhatsApp shows *bold* and _italic_.">
              <textarea ref={bodyRef} className={cn(inputClass, "min-h-24")} id={`${prefix}-body`} rows={10} maxLength={4000} value={values.body} onChange={(e) => set("body", e.target.value)} aria-invalid={Boolean(fe.body)} />
            </Field>
            <div>
              <p className="mb-1 text-xs font-medium text-[#444]">Insert a placeholder</p>
              <div className="flex flex-wrap gap-1.5">
                {SHARE_VARIABLES.map((v) => (
                  <button key={v.name} type="button" onClick={() => insert(v.name)} title={v.label} className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-xs text-brand-700 hover:bg-brand-50">
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            </div>
            {unknown.length ? (
              <Alert tone="warning">
                Unknown placeholder{unknown.length === 1 ? "" : "s"}: {unknown.map((u) => `{{${u}}}`).join(", ")}. They will be left empty.
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : templateId ? "Save template" : "Create template"}
              </Button>
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </fieldset>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-[#444]">Preview with example values</p>
            <div className="rounded-xl bg-[#e7ddd3] p-3">
              <div className="ml-auto max-w-[90%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm break-words whitespace-pre-wrap text-[#111b21] shadow-sm">
                {values.channel !== "whatsapp" && values.subject ? <p className="mb-2 font-semibold">{renderShareMessage(values.subject, sample)}</p> : null}
                {renderShareMessage(values.body, sample) || <span className="text-muted">Your message appears here.</span>}
              </div>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
