"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Send } from "lucide-react";
import { sendProviderTest, updateEmailSettings, type EmailActionResult } from "@/app/actions/email";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input, Textarea } from "@/components/ui/field";
import { emailSettingsSchema, type EmailSettingsInput } from "@/lib/validation/email";

export function EmailSettingsForm({ initial, readOnly, businessName }: { initial: EmailSettingsInput; readOnly: boolean; businessName: string }) {
  const router = useRouter();
  const [result, setResult] = useState<EmailActionResult>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    reset,
    formState: { errors },
  } = useForm<EmailSettingsInput, unknown, z.output<typeof emailSettingsSchema>>({ resolver: zodResolver(emailSettingsSchema), defaultValues: initial });

  // The server re-parses the raw input with the same schema.
  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      const raw = getValues();
      const res = await updateEmailSettings(raw);
      for (const [name, msgs] of Object.entries(res.fieldErrors ?? {})) if (msgs?.[0]) setError(name as keyof EmailSettingsInput, { message: msgs[0] });
      setResult(res);
      if (res.ok) {
        reset(raw);
        router.refresh();
      }
    });
  };
  const err = (n: keyof EmailSettingsInput) => errors[n]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <div aria-live="polite">{result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}</div>
      <fieldset disabled={readOnly || pending} className="grid min-w-0 gap-4">
        <Field id="es-adminRecipients" label="Team notification recipients" error={err("adminRecipients")} hint="One email address per line, up to 20. If empty, the owner's sign-in email is used.">
          <Textarea
            id="es-adminRecipients"
            rows={4}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(err("adminRecipients"))}
            aria-describedby={describedBy("es-adminRecipients", err("adminRecipients"), true)}
            {...register("adminRecipients")}
          />
        </Field>
        <Field id="es-replyTo" label="Reply-to address" error={err("replyTo")} hint="Where candidates' replies go. Leave empty to reply to the sender.">
          <Input id="es-replyTo" type="email" autoCapitalize="none" maxLength={254} aria-invalid={Boolean(err("replyTo"))} aria-describedby={describedBy("es-replyTo", err("replyTo"), true)} {...register("replyTo")} />
        </Field>
        <Field id="es-senderName" label="Sender name" error={err("senderName")} hint={`Shown as the sender when EMAIL_FROM has no name. Default: ${businessName}.`}>
          <Input id="es-senderName" maxLength={80} placeholder={businessName} aria-invalid={Boolean(err("senderName"))} aria-describedby={describedBy("es-senderName", err("senderName"), true)} {...register("senderName")} />
        </Field>
      </fieldset>
      {!readOnly ? (
        <div>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function ProviderTestButton({ email }: { email: string }) {
  const [result, setResult] = useState<EmailActionResult>();
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <div>
        <Button
          variant="secondary"
          disabled={pending}
          aria-busy={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(undefined);
              setResult(await sendProviderTest());
            })
          }
        >
          <Send className="size-4" aria-hidden /> {pending ? "Sending…" : "Send test email"}
        </Button>
      </div>
      <p className="text-xs text-muted">Sends to {email || "your sign-in address"}. The result is also recorded in the email log.</p>
      <div aria-live="polite">{result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}</div>
    </div>
  );
}
