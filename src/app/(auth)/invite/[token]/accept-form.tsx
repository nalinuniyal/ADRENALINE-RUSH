"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { acceptInvitation } from "@/app/actions/team";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input } from "@/components/ui/field";
import { PASSWORD_RULES } from "@/lib/validation/auth";
import { acceptInviteSchema } from "@/lib/validation/team";

type FormInput = z.input<typeof acceptInviteSchema>;

export function AcceptInviteForm({ token, email, initialName }: { token: string; email: string; initialName: string }) {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<FormInput, unknown, z.output<typeof acceptInviteSchema>>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { token, mode: "new", fullName: initialName, password: "", confirmPassword: "" },
  });
  const existing = useWatch({ control, name: "mode" }) === "existing";

  const onSubmit = () => {
    setServerError(undefined);
    startTransition(async () => {
      const res = await acceptInvitation(getValues());
      // On success the action redirects to the dashboard.
      if (!res || res.ok) return;
      if (res.needsExistingPassword) {
        setValue("mode", "existing");
        setValue("password", "");
        setValue("confirmPassword", "");
      }
      if (res.message) setServerError(res.message);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as keyof FormInput, { message: messages[0] });
      }
    });
  };

  const err = (k: keyof FormInput) => errors[k]?.message as string | undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 grid gap-4" noValidate>
      {serverError ? <Alert tone={existing ? "info" : "danger"}>{serverError}</Alert> : null}
      <Field id="acc-email" label="Email">
        <Input id="acc-email" type="email" value={email} readOnly disabled autoComplete="username" />
      </Field>
      <Field id="acc-name" label="Your name" error={err("fullName")}>
        <Input id="acc-name" autoComplete="name" aria-invalid={Boolean(err("fullName"))} aria-describedby={describedBy("acc-name", err("fullName"))} {...register("fullName")} />
      </Field>
      <Field id="acc-password" label={existing ? "Current password" : "Choose a password"} error={err("password")} hint={existing ? undefined : PASSWORD_RULES}>
        <Input
          id="acc-password"
          type="password"
          autoComplete={existing ? "current-password" : "new-password"}
          aria-invalid={Boolean(err("password"))}
          aria-describedby={describedBy("acc-password", err("password"), !existing)}
          {...register("password")}
        />
      </Field>
      {existing ? null : (
        <Field id="acc-confirm" label="Confirm password" error={err("confirmPassword")}>
          <Input id="acc-confirm" type="password" autoComplete="new-password" aria-invalid={Boolean(err("confirmPassword"))} aria-describedby={describedBy("acc-confirm", err("confirmPassword"))} {...register("confirmPassword")} />
        </Field>
      )}
      <Button type="submit" className="mt-2 w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Setting up your access…" : existing ? "Accept and sign in" : "Create my login and join"}
      </Button>
    </form>
  );
}
