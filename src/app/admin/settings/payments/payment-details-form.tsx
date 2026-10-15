"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Eye, QrCode } from "lucide-react";
import { savePaymentDetails } from "@/app/actions/finance-upi";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ACCOUNT_TYPE_LABELS, buildUpiLink, CONFIRM_EMAIL_PLACEHOLDERS, fillPlaceholders, isValidAccountNumber, isValidVpa, maskAccountNumber, normalizeIfsc } from "@/lib/finance/upi";
import { paymentDetailsSchema, type PaymentDetailsInput, type PaymentDetailsOutput } from "@/lib/validation/payment-details";

type TextName = Exclude<FieldPath<PaymentDetailsInput>, "showOnPayPage" | "showInReminders" | "showOnCoursePages" | "confirmEmailEnabled" | "keepAccountNumber" | "bankAccountType">;

const SAMPLE_PAISE = 500000;

export function PaymentDetailsForm({
  initial,
  savedNumberMasked,
  businessName,
  qrUrl,
}: {
  initial: PaymentDetailsInput;
  /** "•••• 1234" when a number is saved but not shown to this user. */
  savedNumberMasked: string | null;
  businessName: string;
  qrUrl: string | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<{ ok: boolean; message?: string }>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm<PaymentDetailsInput, unknown, PaymentDetailsOutput>({ resolver: zodResolver(paymentDetailsSchema), defaultValues: initial });
  const values = useWatch({ control }) as PaymentDetailsInput;

  const onSubmit = () => {
    setResult(undefined);
    startTransition(async () => {
      const raw = getValues();
      const res = await savePaymentDetails(raw);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as FieldPath<PaymentDetailsInput>, { message: messages[0] });
      }
      setResult(res);
      if (res.ok) {
        reset(getValues());
        router.refresh();
      }
    });
  };
  const onInvalid = () => setResult({ ok: false, message: "Please fix the highlighted fields." });

  const text = (name: TextName, label: string, opts: { hint?: ReactNode; placeholder?: string; multiline?: number; maxLength?: number; className?: string; required?: boolean; inputMode?: "numeric" | "text"; autoComplete?: string } = {}) => {
    const error = errors[name]?.message;
    const common = {
      id: name,
      placeholder: opts.placeholder,
      maxLength: opts.maxLength,
      inputMode: opts.inputMode,
      autoComplete: opts.autoComplete ?? "off",
      "aria-invalid": Boolean(error),
      "aria-describedby": describedBy(name, error, opts.hint),
    };
    return (
      <Field id={name} label={label} error={error} hint={opts.hint} className={opts.className} required={opts.required}>
        {opts.multiline ? <Textarea rows={opts.multiline} {...common} {...register(name)} /> : <Input type="text" {...common} {...register(name)} />}
      </Field>
    );
  };

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate aria-label="Payment details" className="grid gap-4 lg:grid-cols-[1fr_minmax(0,380px)]">
      <fieldset disabled={pending} className="grid min-w-0 content-start gap-4">
        {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}

        <Card>
          <CardHeader>
            <CardTitle>UPI</CardTitle>
            <CardDescription>Students scan a QR code or tap “Pay with UPI app”; the amount is filled in for them.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text("upiVpa", "UPI ID", { placeholder: "yourname@okhdfcbank", maxLength: 100, hint: "Find it in your UPI app under your profile, e.g. name@ybl or 98xxxxxx@paytm." })}
            {text("upiPayeeName", "Payee name", { maxLength: 80, hint: "The name your UPI account is registered to. Students see it when they pay." })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bank transfer</CardTitle>
            <CardDescription>For NEFT / IMPS / RTGS. Leave empty if you only take UPI.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {text("bankAccountHolder", "Account holder name", { maxLength: 100 })}
            {text("bankAccountNumber", "Account number", {
              maxLength: 24,
              inputMode: "numeric",
              placeholder: savedNumberMasked && values.keepAccountNumber ? `Saved: ${savedNumberMasked}` : "",
              hint: savedNumberMasked && values.keepAccountNumber ? "Leave empty to keep the saved number, or type a new one." : "9 to 18 digits.",
            })}
            {text("bankIfsc", "IFSC", { maxLength: 11, placeholder: "HDFC0001234", hint: "11 characters; the 5th is a zero." })}
            {text("bankName", "Bank name", { maxLength: 100 })}
            {text("bankBranch", "Branch", { maxLength: 100 })}
            <Field id="bankAccountType" label="Account type" error={errors.bankAccountType?.message}>
              <Select id="bankAccountType" {...register("bankAccountType")}>
                <option value="">Not shown</option>
                <option value="savings">Savings</option>
                <option value="current">Current</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instructions and where to show</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {text("instructions", "Payment instructions (optional)", {
              multiline: 3,
              maxLength: 1000,
              placeholder: "Please add your name in the payment note. After paying, enter the UTR on this page.",
              hint: "Shown under the payment details.",
            })}
            <Checkbox id="showOnPayPage" label="Show on students’ fee payment pages" description="The private /pay links you send from Fees & dues." {...register("showOnPayPage")} />
            <Checkbox id="showInReminders" label="Add the UPI ID to reminder messages" description="Fee reminders by WhatsApp or email also mention your UPI ID and the pay link." {...register("showInReminders")} />
            <Checkbox id="showOnCoursePages" label="Show on public course pages" description="Anyone visiting a course page can see your UPI ID and bank details. Off by default." {...register("showOnCoursePages")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Confirmation email</CardTitle>
            <CardDescription>
              Sent to the student when you approve a payment they reported (needs an email provider, see Marketing › Emails › Settings). Placeholders:{" "}
              {CONFIRM_EMAIL_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Checkbox id="confirmEmailEnabled" label="Email the student when I approve a payment" {...register("confirmEmailEnabled")} />
            {text("confirmEmailSubject", "Subject", { maxLength: 200 })}
            {text("confirmEmailBody", "Message", { multiline: 7, maxLength: 4000 })}
          </CardContent>
        </Card>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface/95 px-4 py-3 shadow-card backdrop-blur">
          <Button type="submit" disabled={pending || !isDirty} aria-busy={pending}>
            {pending ? "Saving…" : "Save payment details"}
          </Button>
          {isDirty ? <span className="text-xs text-muted">You have unsaved changes.</span> : null}
        </div>
      </fieldset>

      <Preview values={values} savedNumberMasked={savedNumberMasked} businessName={businessName} qrUrl={qrUrl} />
    </form>
  );
}

/** What a student sees, updated as you type (sample amount ₹5,000). */
function Preview({ values, savedNumberMasked, businessName, qrUrl }: { values: PaymentDetailsInput; savedNumberMasked: string | null; businessName: string; qrUrl: string | null }) {
  const vpa = (values.upiVpa ?? "").trim().toLowerCase();
  const validVpa = vpa && isValidVpa(vpa);
  const link = validVpa ? buildUpiLink({ vpa, payeeName: values.upiPayeeName, amountPaise: SAMPLE_PAISE, note: "Sample Course FEE-1A2B3C4D" }) : null;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!link) return;
    const t = window.setTimeout(() => {
      import("qrcode")
        .then((m) => m.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 4 }))
        .then((svg) => alive && setQr(`data:image/svg+xml;base64,${btoa(svg)}`))
        .catch(() => alive && setQr(null));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [link]);

  const typed = (values.bankAccountNumber ?? "").replace(/\s+/g, "");
  const number = typed ? (isValidAccountNumber(typed) ? typed : maskAccountNumber(typed)) : values.keepAccountNumber ? savedNumberMasked : null;
  const hasBank = Boolean(number || values.bankIfsc || values.bankAccountHolder);
  const confirm = fillPlaceholders(values.confirmEmailBody ?? "", {
    first_name: "Asha",
    amount: "₹5,000",
    course: "Sample Course",
    receipt_number: "AR-2026-0001",
    outstanding: "₹10,000",
    business_name: businessName,
    utr: "123456789012",
  });

  return (
    <aside aria-label="Preview" className="grid content-start gap-3 lg:sticky lg:top-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <Eye className="size-3.5" aria-hidden /> Live preview
      </p>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card" data-testid="payment-preview">
        <p className="text-xs text-muted">{businessName}</p>
        <p className="text-2xl font-bold tabular-nums">₹5,000</p>
        {values.showOnPayPage ? null : <p className="mt-2 text-xs text-warning-700">Hidden on pay pages (switched off).</p>}
        {validVpa ? (
          <div className="mt-3 grid justify-items-center gap-2 border-t border-line pt-3">
            <p className="flex items-center gap-1.5 self-start text-sm font-semibold">
              <QrCode className="size-4 text-brand-600" aria-hidden /> Pay by UPI
            </p>
            {qr && link ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated preview
              <img src={qr} alt="Preview of the UPI QR code" width={160} height={160} className="size-40 rounded border border-line bg-white" />
            ) : (
              <div className="ar-skeleton size-40 rounded" />
            )}
            <p className="font-mono text-sm break-all">{vpa}</p>
            {values.upiPayeeName ? <p className="text-xs text-muted">{values.upiPayeeName}</p> : null}
            {qrUrl ? <p className="text-xs text-muted">+ your own QR image as an alternative</p> : null}
          </div>
        ) : vpa ? (
          <p className="mt-3 text-xs text-danger-700">Enter a valid UPI ID to see the QR code.</p>
        ) : null}
        {hasBank ? (
          <div className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold">
              <Building2 className="size-4 text-brand-600" aria-hidden /> Bank transfer
            </p>
            {values.bankAccountHolder ? <p>{values.bankAccountHolder}</p> : null}
            {number ? <p className="font-mono">A/c {number}</p> : null}
            {values.bankIfsc ? <p className="font-mono">IFSC {normalizeIfsc(values.bankIfsc)}</p> : null}
            {values.bankName || values.bankBranch ? <p className="text-xs text-muted">{[values.bankName, values.bankBranch].filter(Boolean).join(", ")}</p> : null}
            {values.bankAccountType ? <p className="text-xs text-muted">{ACCOUNT_TYPE_LABELS[values.bankAccountType] ?? values.bankAccountType} account</p> : null}
          </div>
        ) : null}
        {values.instructions ? <p className="mt-3 border-t border-line pt-3 text-xs whitespace-pre-line">{values.instructions}</p> : null}
        {!validVpa && !hasBank ? <p className="mt-3 text-xs text-muted">Add a UPI ID or bank details to see them here.</p> : null}
      </div>
      {values.confirmEmailEnabled ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-xs shadow-card">
          <p className="font-semibold">Confirmation email (sample)</p>
          <p className="mt-1 text-muted">{fillPlaceholders(values.confirmEmailSubject ?? "", { course: "Sample Course", first_name: "Asha", amount: "₹5,000", business_name: businessName, receipt_number: "AR-2026-0001", outstanding: "₹10,000", utr: "123456789012" })}</p>
          <p className="mt-2 whitespace-pre-line">{confirm}</p>
        </div>
      ) : null}
    </aside>
  );
}
