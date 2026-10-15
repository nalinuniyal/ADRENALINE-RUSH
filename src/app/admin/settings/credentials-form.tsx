"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { updateMyCredentials } from "@/app/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input } from "@/components/ui/field";
import { PASSWORD_RULES } from "@/lib/validation/auth";
import { credentialsSchema, type CredentialsInput } from "@/lib/validation/settings";

/** Change your own sign-in email and password. */
export function CredentialsForm({ email }: { email: string }) {
  const [result, setResult] = useState<{ ok: boolean; message?: string }>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    reset,
    formState: { errors },
  } = useForm<CredentialsInput>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email, currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      const values = getValues();
      const res = await updateMyCredentials(values);
      setResult(res);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as keyof CredentialsInput, { message: messages[0] });
      }
      if (res.ok) reset({ email: values.email.trim().toLowerCase(), currentPassword: "", newPassword: "", confirmPassword: "" });
    });
  };

  const field = (name: keyof CredentialsInput, label: string, opts: { type?: string; autoComplete?: string; hint?: string } = {}) => {
    const error = errors[name]?.message;
    return (
      <Field id={`cred-${name}`} label={label} error={error} hint={opts.hint}>
        <Input
          id={`cred-${name}`}
          type={opts.type ?? "password"}
          autoComplete={opts.autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(`cred-${name}`, error, opts.hint)}
          {...register(name)}
        />
      </Field>
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5" noValidate>
      {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {field("email", "Sign-in email", { type: "email", autoComplete: "email" })}
        {field("currentPassword", "Current password", { autoComplete: "current-password", hint: "Needed for any change." })}
        {field("newPassword", "New password", { autoComplete: "new-password", hint: `Leave empty to keep it. ${PASSWORD_RULES}` })}
        {field("confirmPassword", "Repeat new password", { autoComplete: "new-password" })}
      </div>
      <div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Update sign-in details"}
        </Button>
      </div>
    </form>
  );
}
