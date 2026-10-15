"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageCircle } from "lucide-react";
import { sendFeeReminder, type FinanceActionResult } from "@/app/actions/finance";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function Feedback({ result, className }: { result?: FinanceActionResult; className?: string }) {
  if (!result?.message) return null;
  return (
    <Alert tone={result.ok ? "success" : "danger"} className={className}>
      {result.message}
    </Alert>
  );
}

/**
 * Opens a tab synchronously (so pop-up blockers allow it), then points it at
 * the URL the server returns; closes it again when there is nothing to open.
 */
export async function openAfter(run: () => Promise<FinanceActionResult>): Promise<FinanceActionResult> {
  const tab = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  const res = await run();
  if (res.ok && res.url && tab) {
    tab.opener = null;
    tab.location.href = res.url;
  } else {
    tab?.close();
  }
  return res;
}

/** "Send reminder" by WhatsApp (click-to-chat) or email for a fee plan / installment. */
export function ReminderButtons({ feePlanId, installmentId, hasPhone, hasEmail, compact }: { feePlanId: string; installmentId?: string | null; hasPhone: boolean; hasEmail: boolean; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FinanceActionResult>();

  const send = (channel: "whatsapp" | "email") => {
    setResult(undefined);
    start(async () => {
      const call = () => sendFeeReminder({ feePlanId, installmentId: installmentId ?? null, channel });
      const res = channel === "whatsapp" ? await openAfter(call) : await call();
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-1.5">
        <Button size={compact ? "xs" : "sm"} variant="secondary" disabled={pending || !hasPhone} onClick={() => send("whatsapp")} title={hasPhone ? undefined : "No phone number saved"}>
          <MessageCircle className="size-3.5" aria-hidden /> WhatsApp reminder
        </Button>
        <Button size={compact ? "xs" : "sm"} variant="secondary" disabled={pending || !hasEmail} onClick={() => send("email")} title={hasEmail ? undefined : "No email saved"}>
          <Mail className="size-3.5" aria-hidden /> Email reminder
        </Button>
      </div>
      <Feedback result={result} className="max-w-sm" />
    </div>
  );
}
