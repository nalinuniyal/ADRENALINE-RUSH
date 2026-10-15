import type { ReactNode } from "react";

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface px-6 py-14 text-center shadow-card animate-fade-up">
      <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand-50 to-transparent" />
      {icon ? (
        <div className="relative flex size-14 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-glow">
          {icon}
        </div>
      ) : null}
      <h2 className="relative text-base font-bold text-fg">{title}</h2>
      {description ? <div className="relative max-w-md text-sm text-muted">{description}</div> : null}
      {action ? <div className="relative mt-1">{action}</div> : null}
    </div>
  );
}
