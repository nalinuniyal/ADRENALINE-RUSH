"use client";

import { useState, useTransition } from "react";
import { updateSharingSettings, type ResourceActionResult } from "@/app/actions/resources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export function WhatsappCountryCodeForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(`+${initial}`);
  const [result, setResult] = useState<ResourceActionResult>();
  const [pending, startTransition] = useTransition();
  const error = result?.fieldErrors?.whatsappCountryCode?.[0];
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(undefined);
        startTransition(async () => setResult(await updateSharingSettings({ whatsappCountryCode: value })));
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="wa-country-code" className="text-xs font-medium text-[#444]">
          Default country code
        </label>
        <Input
          id="wa-country-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="tel"
          maxLength={5}
          className="w-24"
          aria-invalid={Boolean(error)}
          aria-describedby="wa-country-code-hint"
        />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <p id="wa-country-code-hint" className={`w-full text-xs ${error ? "font-medium text-danger-700" : result?.ok ? "text-success-700" : "text-muted"}`} role={result ? "status" : undefined}>
        {error ?? result?.message ?? "Added to phone numbers saved without one (for India, +91)."}
      </p>
    </form>
  );
}
