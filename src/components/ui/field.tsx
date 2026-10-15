import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg transition-[border-color,box-shadow] duration-150 placeholder:text-[#939393] hover:border-[#939393] focus:border-brand-400 focus:outline-none focus:ring-[3px] focus:ring-brand-400/25 aria-[invalid=true]:border-danger-700 aria-[invalid=true]:ring-danger-700/15 disabled:bg-canvas disabled:text-muted";

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

/** Label + control + hint + error, wired up with aria attributes (Lightning form-element style). */
export function Field({ id, label, error, hint, required, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-[#444]">
        {required ? (
          <abbr title="required" className="mr-0.5 text-danger-700 no-underline">
            *
          </abbr>
        ) : null}
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger-700 animate-fade-in">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: unknown): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, "pr-8", className)} {...props} />;
}

export function Checkbox({
  id,
  label,
  description,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; description?: string }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 size-4 rounded border-line-strong accent-brand-600" {...props} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-fg">{label}</span>
        {description ? <span className="block text-muted">{description}</span> : null}
      </label>
    </div>
  );
}
