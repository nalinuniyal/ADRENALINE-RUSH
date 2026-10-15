"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { createCategory, deleteCategory, updateCategory, type ActionResult } from "@/app/actions/courses";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { describedBy, Field, Input, Textarea } from "@/components/ui/field";
import { categorySchema, toSlug, type CategoryFormInput } from "@/lib/validation/courses";

type Category = { id: string; name: string; slug: string; description: string | null; position: number; courseCount: number };
type Output = z.output<typeof categorySchema>;

export function CategoryManager({ categories, canManage }: { categories: Category[]; canManage: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult>();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextPosition = String(categories.length ? Math.max(...categories.map((c) => c.position)) + 10 : 10);

  const done = (res: ActionResult) => {
    setResult(res);
    if (res.ok) router.refresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr] lg:items-start">
      <Card>
        <CardHeader icon={<Tags className="size-5 text-violet-500" aria-hidden />}>
          <CardTitle>Categories</CardTitle>
          <CardDescription>{categories.length ? `${categories.length} categor${categories.length === 1 ? "y" : "ies"}` : "None yet"}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div aria-live="polite">{result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}</div>
          {categories.length === 0 ? (
            <EmptyState
              icon={<Tags className="size-6" aria-hidden />}
              title="No categories yet"
              description={canManage ? "Add a category, then choose it on each course." : "Categories will appear here once they are created."}
            />
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {categories.map((c) => (
                <li key={c.id} className="px-3 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold break-words">{c.name}</p>
                      <p className="text-xs text-muted">
                        <code className="rounded bg-canvas px-1">{c.slug}</code> · Position {c.position} · {c.courseCount} course{c.courseCount === 1 ? "" : "s"}
                      </p>
                      {c.description ? <p className="mt-1 text-sm break-words text-[#444]">{c.description}</p> : null}
                    </div>
                    {canManage ? (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(editing === c.id ? null : c.id)} aria-expanded={editing === c.id} aria-label={`Edit ${c.name}`}>
                          <Pencil className="size-4" aria-hidden /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger-700 hover:bg-danger-50"
                          onClick={() => setConfirmDelete(confirmDelete === c.id ? null : c.id)}
                          aria-expanded={confirmDelete === c.id}
                          aria-label={`Delete ${c.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden /> Delete
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {confirmDelete === c.id ? (
                    <div role="group" aria-label={`Confirm deleting ${c.name}`} className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
                      <span className="flex-1">
                        Delete “{c.name}”?{c.courseCount ? ` Its ${c.courseCount} course${c.courseCount === 1 ? "" : "s"} will become uncategorised.` : ""}
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const res = await deleteCategory(c.id);
                            setConfirmDelete(null);
                            done(res);
                          })
                        }
                      >
                        Delete category
                      </Button>
                    </div>
                  ) : null}
                  {editing === c.id ? (
                    <div className="mt-3 rounded-lg border border-line bg-canvas/40 p-3">
                      <CategoryForm
                        initial={{ name: c.name, slug: c.slug, description: c.description ?? "", position: String(c.position) }}
                        autoSlug={false}
                        submitLabel="Save category"
                        save={(v) => updateCategory(c.id, v)}
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
            <CardTitle>Add a category</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryForm
              key={categories.length}
              initial={{ name: "", slug: "", description: "", position: nextPosition }}
              autoSlug
              submitLabel="Add category"
              save={createCategory}
              onDone={done}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CategoryForm({
  initial,
  autoSlug,
  submitLabel,
  save,
  onDone,
  onCancel,
}: {
  initial: CategoryFormInput;
  autoSlug: boolean;
  submitLabel: string;
  save: (values: CategoryFormInput) => Promise<ActionResult>;
  onDone: (res: ActionResult) => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [slugEdited, setSlugEdited] = useState(!autoSlug);
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const {
    getValues,
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<CategoryFormInput, unknown, Output>({ resolver: zodResolver(categorySchema), defaultValues: initial });

  // The server re-parses the raw input with the same schema.
  const onSubmit = () => {
    setMessage(undefined);
    startTransition(async () => {
      const res = await save(getValues());
      for (const [name, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(name as keyof CategoryFormInput, { message: messages[0] });
      }
      if (res.ok) onDone(res);
      else setMessage(res.message);
    });
  };

  const err = (n: keyof CategoryFormInput) => errors[n]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <fieldset disabled={pending} className="grid min-w-0 gap-4">
        <Field id={id("name")} label="Name" required error={err("name")}>
          <Input
            id={id("name")}
            maxLength={80}
            aria-invalid={Boolean(err("name"))}
            aria-describedby={describedBy(id("name"), err("name"))}
            {...register("name", {
              onChange: (e: { target: { value: string } }) => {
                if (!slugEdited) setValue("slug", toSlug(e.target.value));
              },
            })}
          />
        </Field>
        <Field id={id("slug")} label="Slug" required error={err("slug")} hint="Used in the public catalogue filter link.">
          <Input
            id={id("slug")}
            maxLength={80}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(err("slug"))}
            aria-describedby={describedBy(id("slug"), err("slug"), true)}
            {...register("slug", { onChange: () => setSlugEdited(true) })}
          />
        </Field>
        <Field id={id("description")} label="Description" error={err("description")}>
          <Textarea id={id("description")} rows={2} maxLength={1000} aria-invalid={Boolean(err("description"))} {...register("description")} />
        </Field>
        <Field id={id("position")} label="Position" error={err("position")} hint="Lower numbers are listed first.">
          <Input id={id("position")} inputMode="numeric" maxLength={5} aria-invalid={Boolean(err("position"))} aria-describedby={describedBy(id("position"), err("position"), true)} {...register("position")} />
        </Field>
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
