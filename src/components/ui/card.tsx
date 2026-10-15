import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-card animate-fade-in", className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  icon,
  actions,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cn("flex items-start gap-3 px-4 pt-4 pb-2", className)} {...props}>
      {icon ? <div className="shrink-0">{icon}</div> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-bold text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[13px] text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t border-line px-4 py-3 text-center text-sm", className)} {...props} />;
}
