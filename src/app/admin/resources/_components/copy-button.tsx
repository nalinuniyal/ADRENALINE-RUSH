"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Copies text; when the clipboard is blocked, shows the text to copy by hand. */
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  onCopied,
  ...props
}: Omit<ButtonProps, "onClick" | "children"> & { text: string | (() => string); label: string; copiedLabel?: string; onCopied?: () => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [value, setValue] = useState("");
  const id = useId();

  const copy = async () => {
    const t = typeof text === "function" ? text() : text;
    setValue(t);
    try {
      await navigator.clipboard.writeText(t);
      setState("copied");
      onCopied?.();
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="inline-flex flex-col">
      <Button variant="secondary" size="sm" {...props} onClick={copy}>
        {state === "copied" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {state === "copied" ? copiedLabel : label}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? `${copiedLabel} to clipboard` : ""}
      </span>
      {state === "failed" ? (
        <span className="mt-2 flex flex-col gap-1 text-xs">
          <label htmlFor={id} className="text-muted">
            Copying is blocked by the browser. Select and copy:
          </label>
          <textarea id={id} readOnly value={value} rows={3} onFocus={(e) => e.currentTarget.select()} className="w-64 max-w-full rounded border border-line-strong px-2 py-1" />
        </span>
      ) : null}
    </span>
  );
}
