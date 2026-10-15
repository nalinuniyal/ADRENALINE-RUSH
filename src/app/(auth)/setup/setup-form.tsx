"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { completeSetup } from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input } from "@/components/ui/field";
import { PASSWORD_RULES, setupSchema, slugify } from "@/lib/validation/auth";

type SetupFormInput = z.input<typeof setupSchema>;
type SetupFormOutput = z.output<typeof setupSchema>;

export function SetupForm({ proof }: { proof: "none" | "token" | "secret-key" }) {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [slugTouched, setSlugTouched] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<SetupFormInput, unknown, SetupFormOutput>({
    resolver: zodResolver(setupSchema),
    defaultValues: { businessName: "Adrenaline Rush", businessSlug: "adrenaline-rush" },
  });

  const onSubmit = (values: SetupFormOutput) => {
    setServerError(undefined);
    startTransition(async () => {
      const result = await completeSetup(values);
      if (result?.error) setServerError(result.error);
      for (const [field, messages] of Object.entries(result?.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as keyof SetupFormInput, { message: messages[0] });
      }
    });
  };

  const fields: {
    name: keyof SetupFormInput;
    label: string;
    type?: string;
    autoComplete?: string;
    hint?: string;
  }[] = [
    ...(proof === "token"
      ? [{ name: "setupToken" as const, label: "Setup token", type: "password", autoComplete: "off", hint: "The ADMIN_SETUP_TOKEN value from your server environment." }]
      : proof === "secret-key"
        ? [{ name: "setupToken" as const, label: "Supabase secret key", type: "password", autoComplete: "off", hint: "Proves you own this site. Supabase → Project Settings → API Keys → Secret key (sb_secret_…). It is checked on the server and never stored." }]
        : []),
    { name: "businessName", label: "Business name" },
    { name: "businessSlug", label: "Business short name", hint: "Lower-case letters, numbers and hyphens." },
    { name: "fullName", label: "Your full name", autoComplete: "name" },
    { name: "email", label: "Your email", type: "email", autoComplete: "email" },
    { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: PASSWORD_RULES },
    { name: "confirmPassword", label: "Confirm password", type: "password", autoComplete: "new-password" },
  ];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-6 grid gap-4" noValidate>
      {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
      {fields.map((f) => {
        const error = errors[f.name]?.message;
        const reg = register(f.name);
        return (
          <Field key={f.name} id={f.name} label={f.label} error={error} hint={f.hint}>
            <Input
              id={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy(f.name, error, f.hint)}
              {...reg}
              onChange={(e) => {
                void reg.onChange(e);
                if (f.name === "businessName" && !slugTouched) {
                  setValue("businessSlug", slugify(e.target.value));
                }
                if (f.name === "businessSlug") setSlugTouched(true);
              }}
            />
          </Field>
        );
      })}
      <Button type="submit" className="mt-2 w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Creating your workspace…" : "Create business and owner account"}
      </Button>
    </form>
  );
}
