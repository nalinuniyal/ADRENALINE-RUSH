"use client";

import { useActionState, useEffect, useState } from "react";
import { submitRegistration, type RegistrationState } from "@/app/actions/registration";
import { Alert } from "@/components/ui/alert";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { RegistrationField } from "@/lib/forms/registration";

const ATTR_COOKIE = "ar_attr";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

/** First-touch campaign attribution: URL UTM params, remembered in a first-party cookie for 90 days. No fingerprinting. */
function useAttribution() {
  const [attr, setAttr] = useState<Record<string, string>>({});
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = url.searchParams.get(k);
      if (v) fromUrl[k] = v.slice(0, 120);
    }
    let stored: Record<string, string> = {};
    try {
      const raw = document.cookie.split("; ").find((c) => c.startsWith(`${ATTR_COOKIE}=`));
      if (raw) stored = JSON.parse(decodeURIComponent(raw.split("=").slice(1).join("=")));
    } catch {
      stored = {};
    }
    const merged = Object.keys(fromUrl).length ? fromUrl : stored;
    if (Object.keys(fromUrl).length) {
      document.cookie = `${ATTR_COOKIE}=${encodeURIComponent(JSON.stringify(fromUrl))}; Max-Age=${60 * 60 * 24 * 90}; Path=/; SameSite=Lax`;
    }
    const ref = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer.slice(0, 500) : "";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only state once on mount
    setAttr({ ...merged, ...(ref ? { referrer: ref } : {}) });
  }, []);
  return attr;
}

export function RegistrationForm({
  slug,
  fields,
  channel = "public_form",
  submitLabel = "Register now",
}: {
  slug: string;
  fields: RegistrationField[];
  channel?: "public_form" | "demo_request";
  submitLabel?: string;
}) {
  const action = submitRegistration.bind(null, slug, channel);
  const [state, formAction] = useActionState<RegistrationState, FormData>(action, {});
  const attr = useAttribution();
  const [meta, setMeta] = useState({ startedAt: 0, token: "" });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only values (time + random token)
    setMeta({ startedAt: Date.now(), token: crypto.randomUUID() });
  }, [state]);

  const v = state.values ?? {};
  const err = (k: string) => state.fieldErrors?.[k]?.[0];

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      {state.error ? <Alert tone="danger" className="sm:col-span-2">{state.error}</Alert> : null}

      {/* Anti-spam: honeypot (hidden from people and assistive tech), timing and one-time token. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="started_at" value={meta.startedAt || ""} />
      <input type="hidden" name="form_token" value={meta.token} />
      {Object.entries(attr).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}

      {fields.map((f) => {
        const id = `f-${f.key}`;
        const e = err(f.key);
        const wide = ["textarea", "multiselect", "radio", "checkbox", "consent"].includes(f.type);
        const common = {
          id,
          name: f.key,
          "aria-invalid": Boolean(e),
          "aria-describedby": describedBy(id, e, f.help_text),
          "aria-required": f.required || undefined,
        };
        const value = v[f.key];

        if (f.type === "checkbox" || f.type === "consent") {
          return (
            <div key={f.key} className="sm:col-span-2">
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 size-4 accent-brand-600" defaultChecked={value === true} {...common} />
                <label htmlFor={id} className="text-sm">
                  {f.required ? <span className="mr-0.5 text-danger-700">*</span> : null}
                  {f.type === "consent" ? (
                    <>
                      {f.label} (
                      <a href="/privacy" target="_blank" className="text-brand-600 underline">
                        read it
                      </a>
                      )
                    </>
                  ) : (
                    f.label
                  )}
                  {f.help_text ? <span id={`${id}-hint`} className="block text-xs text-muted">{f.help_text}</span> : null}
                </label>
              </div>
              {e ? <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger-700">{e}</p> : null}
            </div>
          );
        }

        if (f.type === "radio" || f.type === "multiselect") {
          const selected = Array.isArray(value) ? (value as string[]) : [value];
          return (
            <fieldset key={f.key} className="sm:col-span-2" aria-describedby={describedBy(id, e, f.help_text)}>
              <legend className="mb-1 text-xs font-medium text-[#444]">
                {f.required ? <span className="mr-0.5 text-danger-700">*</span> : null}
                {f.label}
              </legend>
              <div className="flex flex-wrap gap-2">
                {f.options.map((opt) => (
                  <label key={opt} className="flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-sm transition has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                    <input type={f.type === "radio" ? "radio" : "checkbox"} name={f.key} value={opt} defaultChecked={selected.includes(opt)} className="accent-brand-600" />
                    {opt}
                  </label>
                ))}
              </div>
              {f.help_text && !e ? <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{f.help_text}</p> : null}
              {e ? <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger-700">{e}</p> : null}
            </fieldset>
          );
        }

        return (
          <Field key={f.key} id={id} label={f.label} required={f.required} error={e} hint={f.help_text} className={wide ? "sm:col-span-2" : undefined}>
            {f.type === "textarea" ? (
              <Textarea {...common} placeholder={f.placeholder ?? undefined} defaultValue={(value as string) ?? ""} maxLength={4000} />
            ) : f.type === "select" ? (
              <Select {...common} defaultValue={(value as string) ?? ""}>
                <option value="">Select…</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            ) : (
              <Input
                {...common}
                type={f.type === "phone" ? "tel" : f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                inputMode={f.type === "number" ? "decimal" : undefined}
                step={f.type === "number" ? "0.5" : undefined}
                min={f.type === "number" ? 0 : undefined}
                autoComplete={f.key === "full_name" ? "name" : f.key === "email" ? "email" : f.key === "phone" ? "tel" : f.key === "city" ? "address-level2" : f.key === "country" ? "country-name" : f.key === "company" ? "organization" : f.key === "job_title" ? "organization-title" : undefined}
                placeholder={f.placeholder ?? undefined}
                defaultValue={(value as string) ?? ""}
                maxLength={300}
              />
            )}
          </Field>
        );
      })}

      <div className="sm:col-span-2">
        <SubmitButton size="lg" className="w-full sm:w-auto" variant="glow" pendingLabel="Submitting…">
          {submitLabel}
        </SubmitButton>
        <p className="mt-3 text-xs text-muted">We only use your details to respond about this course. No spam, ever.</p>
      </div>
    </form>
  );
}
