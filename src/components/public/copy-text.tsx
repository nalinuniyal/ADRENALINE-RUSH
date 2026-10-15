"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small "Copy" button for a value shown next to it (UPI ID, account number, IFSC…). */
export function CopyText({ value, label, className }: { value: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={state === "copied" ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-surface px-2 text-xs font-medium text-brand-600 transition hover:bg-brand-50",
        className,
      )}
    >
      {state === "copied" ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select to copy" : "Copy"}
    </button>
  );
}
