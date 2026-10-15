"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createRegistrationField,
  deleteRegistrationField,
  moveRegistrationField,
  setRegistrationFieldActive,
  updateRegistrationField,
  type ActionResult,
} from "@/app/actions/courses";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FIELD_TYPES, type FieldType } from "@/lib/forms/registration";
import {
  OPTION_FIELD_TYPES,
  registrationFieldSchema,
  toFieldKey,
  uniqueFieldKey,
  type RegistrationFieldInput,
  type RegistrationFieldOutput,
} from "@/lib/validation/courses";
import { cn } from "@/lib/utils";

export type BuilderField = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  maps_to: string | null;
  required: boolean;
  options: string[];
  help_text: string | null;
  placeholder: string | null;
  is_active: boolean;
};

const typeLabel = (t: FieldType) => FIELD_TYPES.find((f) => f.value === t)?.label ?? t;
const isProtected = (f: BuilderField) => f.maps_to !== null || f.key === "privacy_consent";

export function FormBuilder({ courseId, fields, readOnly = false }: { courseId: string; fields: BuilderField[]; readOnly?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionResult>) => {
    setResult(undefined);
    startTransition(async () => {
      const res = await fn();
      setConfirmDelete(null);
      if (res.message) setResult(res);
      if (res.ok) router.refresh();
    });
  };

  const activeCount = fields.filter((f) => f.is_active).length;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        {activeCount} of {fields.length} fields are shown on the public form, in this order. Standard fields
        <Lock className="mx-1 inline size-3.5 align-[-2px]" aria-label="locked" />
        save into the candidate record; custom fields are stored as answers on the registration.
      </p>
      <div aria-live="polite">{result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}</div>

      <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line" aria-label="Registration form fields">
        {fields.map((f, i) => {
          const prot = isProtected(f);
          return (
            <li key={f.id} className={cn("bg-surface", !f.is_active && "bg-canvas/60")}>
              <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium break-words", !f.is_active && "text-muted line-through decoration-1")}>
                    {f.label}
                    {f.required ? (
                      <abbr title="required" className="ml-0.5 text-danger-700 no-underline">
                        *
                      </abbr>
                    ) : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <code className="rounded bg-canvas px-1">{f.key}</code>
                    <span>{typeLabel(f.type)}</span>
                    {prot ? (
                      <Badge tone="brand">
                        <Lock className="size-3" aria-hidden /> Standard
                      </Badge>
                    ) : (
                      <Badge tone="violet">Custom</Badge>
                    )}
                    {f.required ? <Badge tone="warning">Required</Badge> : null}
                    {!f.is_active ? <Badge>Hidden</Badge> : null}
                    {f.options.length ? <span>{f.options.length} options</span> : null}
                  </p>
                </div>
                {!readOnly ? (
                  <div className="flex flex-wrap gap-1">
                    <Button size="icon" variant="ghost" disabled={pending || i === 0} onClick={() => run(() => moveRegistrationField(f.id, "up"))} aria-label={`Move ${f.label} up`} title="Move up">
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={pending || i === fields.length - 1}
                      onClick={() => run(() => moveRegistrationField(f.id, "down"))}
                      aria-label={`Move ${f.label} down`}
                      title="Move down"
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setEditing(editing === f.id ? null : f.id)}
                      aria-label={`Edit ${f.label}`}
                      aria-expanded={editing === f.id}
                      title="Edit"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={pending || (f.key === "privacy_consent" && f.is_active)}
                      onClick={() => run(() => setRegistrationFieldActive(f.id, !f.is_active))}
                      aria-label={f.is_active ? `Hide ${f.label} from the form` : `Show ${f.label} on the form`}
                      title={f.key === "privacy_consent" ? "Privacy consent is always shown" : f.is_active ? "Hide" : "Show"}
                    >
                      {f.is_active ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </Button>
                    {!prot ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-danger-700 hover:bg-danger-50"
                        disabled={pending}
                        onClick={() => setConfirmDelete(confirmDelete === f.id ? null : f.id)}
                        aria-label={`Delete ${f.label}`}
                        aria-expanded={confirmDelete === f.id}
                        title="Delete"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {confirmDelete === f.id ? (
                <div role="group" aria-label={`Confirm deleting ${f.label}`} className="flex flex-wrap items-center gap-2 border-t border-danger-700/20 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                  <span className="flex-1">Delete “{f.label}”? Answers already submitted are kept on past registrations.</span>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteRegistrationField(f.id))}>
                    Delete field
                  </Button>
                </div>
              ) : null}
              {editing === f.id && !readOnly ? (
                <div className="border-t border-line bg-canvas/40 px-3 py-3">
                  <FieldEditor
                    field={f}
                    takenKeys={fields.map((x) => x.key)}
                    onCancel={() => setEditing(null)}
                    onSaved={(res) => {
                      setResult(res);
                      setEditing(null);
                      router.refresh();
                    }}
                    save={(values) => updateRegistrationField(f.id, values)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {!readOnly ? (
        editing === "new" ? (
          <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
            <h3 className="mb-3 text-sm font-bold">New custom field</h3>
            <FieldEditor
              takenKeys={fields.map((x) => x.key)}
              onCancel={() => setEditing(null)}
              onSaved={(res) => {
                setResult(res);
                setEditing(null);
                router.refresh();
              }}
              save={(values) => createRegistrationField(courseId, values)}
            />
          </div>
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setEditing("new")} disabled={pending}>
              <Plus className="size-4" aria-hidden /> Add custom field
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  takenKeys,
  save,
  onSaved,
  onCancel,
}: {
  field?: BuilderField;
  takenKeys: string[];
  save: (values: RegistrationFieldInput) => Promise<ActionResult>;
  onSaved: (res: ActionResult) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const isNew = !field;
  const prot = field ? isProtected(field) : false;
  const isPrivacy = field?.key === "privacy_consent";
  const [keyEdited, setKeyEdited] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const {
    getValues,
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<RegistrationFieldInput, unknown, RegistrationFieldOutput>({
    resolver: zodResolver(registrationFieldSchema),
    defaultValues: {
      label: field?.label ?? "",
      key: field?.key ?? "",
      type: field?.type ?? "text",
      required: field?.required ?? false,
      options: field?.options.join("\n") ?? "",
      helpText: field?.help_text ?? "",
      placeholder: field?.placeholder ?? "",
    },
  });
  const type = useWatch({ control, name: "type" });
  const showOptions = OPTION_FIELD_TYPES.includes(type);

  const labelField = register("label", {
    onChange: (e: { target: { value: string } }) => {
      if (isNew && !keyEdited) setValue("key", uniqueFieldKey(toFieldKey(e.target.value), takenKeys), { shouldValidate: Boolean(errors.key) });
    },
  });

  // The server re-parses the raw input with the same schema.
  const onSubmit = () => {
    setMessage(undefined);
    startTransition(async () => {
      const res = await save(getValues());
      for (const [name, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(name as keyof RegistrationFieldInput, { message: messages[0] });
      }
      if (res.ok) onSaved(res);
      else setMessage(res.message ?? "Could not save the field.");
    });
  };

  const err = (name: keyof RegistrationFieldInput) => errors[name]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4" aria-label={isNew ? "New field" : `Edit ${field.label}`}>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      {prot ? (
        <p className="text-xs text-muted">
          This is a standard field linked to the candidate record, so its key and type are fixed{isPrivacy ? " and it must stay required" : ""}.
        </p>
      ) : null}
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field id={id("label")} label="Label" required error={err("label")}>
          <Input id={id("label")} maxLength={200} aria-invalid={Boolean(err("label"))} aria-describedby={describedBy(id("label"), err("label"))} {...labelField} />
        </Field>
        <Field id={id("key")} label="Key" required error={err("key")} hint={isNew ? "Used in exports. Cannot be changed later." : "Keys cannot be changed after a field is created."}>
          <Input
            id={id("key")}
            maxLength={40}
            readOnly={!isNew}
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono"
            aria-invalid={Boolean(err("key"))}
            aria-describedby={describedBy(id("key"), err("key"), true)}
            {...register("key", { onChange: () => setKeyEdited(true) })}
          />
        </Field>
        <Field id={id("type")} label="Field type" required error={err("type")}>
          {prot && field ? (
            <Input id={id("type")} readOnly value={typeLabel(field.type)} aria-readonly />
          ) : (
            <Select id={id("type")} aria-invalid={Boolean(err("type"))} {...register("type")}>
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-end pb-2">
          {type === "consent" ? (
            <p className="text-sm text-muted">Consent boxes are always required.</p>
          ) : (
            <Checkbox id={id("required")} label="Required" {...register("required")} />
          )}
        </div>
        {showOptions ? (
          <Field id={id("options")} label="Options" required error={err("options")} hint="One option per line." className="sm:col-span-2">
            <Textarea id={id("options")} rows={4} aria-invalid={Boolean(err("options"))} aria-describedby={describedBy(id("options"), err("options"), true)} {...register("options")} />
          </Field>
        ) : null}
        <Field id={id("placeholder")} label="Placeholder" error={err("placeholder")}>
          <Input id={id("placeholder")} maxLength={200} aria-invalid={Boolean(err("placeholder"))} {...register("placeholder")} />
        </Field>
        <Field id={id("helpText")} label="Help text" error={err("helpText")}>
          <Input id={id("helpText")} maxLength={500} aria-invalid={Boolean(err("helpText"))} {...register("helpText")} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : isNew ? "Add field" : "Save field"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
