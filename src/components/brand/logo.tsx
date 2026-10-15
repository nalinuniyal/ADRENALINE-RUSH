import { cn } from "@/lib/utils";

/** Original Adrenaline Rush mark: a forward-leaning pulse inside a cloud-blue tile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 drop-shadow-[0_4px_12px_rgb(27_150_255/0.45)]", className)}>
      <defs>
        <linearGradient id="ar-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b96ff" />
          <stop offset="0.55" stopColor="#0176d3" />
          <stop offset="1" stopColor="#9050e9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ar-mark)" />
      <path d="M5 18.5h6l2.6-7 4.2 12 3-8.5H27" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, inverse = false, compact = false }: { className?: string; inverse?: boolean; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {compact ? null : (
        <span className={cn("font-display text-[15px] font-bold tracking-tight", inverse ? "text-white" : "text-ink-900")}>
          Adrenaline <span className={inverse ? "text-volt-400" : "text-brand-600"}>Rush</span>
        </span>
      )}
    </span>
  );
}
