"use client";

import { useState, useTransition } from "react";
import { updateMyProfile } from "@/app/actions/settings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describedBy, Field, Input } from "@/components/ui/field";

export function ProfileForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<{ ok: boolean; message?: string; error?: string }>();
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await updateMyProfile({ fullName: name });
          setResult({ ...res, error: res.fieldErrors?.fullName?.[0] });
        });
      }}
    >
      <Field id="fullName" label="Full name" error={result?.error} className="flex-1">
        <Input
          id="fullName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          aria-invalid={Boolean(result?.error)}
          aria-describedby={describedBy("fullName", result?.error)}
        />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {result?.message && !result.error ? (
        <Alert tone={result.ok ? "success" : "danger"} className="sm:ml-2">
          {result.message}
        </Alert>
      ) : null}
    </form>
  );
}
