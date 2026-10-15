import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Lightning-style buttons: brand, neutral (outline), destructive, plus dark-surface variants. */
export const buttonVariants = cva(
  "relative inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow-[0_6px_20px_-6px_rgb(1_118_211/0.7)]",
        secondary: "border border-line-strong bg-surface text-brand-600 hover:bg-brand-50 hover:border-brand-300",
        ghost: "text-brand-600 hover:bg-brand-50",
        danger: "bg-danger-700 text-white hover:bg-[#8e030f]",
        success: "bg-success-700 text-white hover:bg-[#22683e]",
        inverse: "bg-white text-ink-900 hover:bg-brand-50 hover:shadow-[0_8px_30px_-8px_rgb(87_227_255/0.7)]",
        outlineInverse: "border border-white/25 text-white backdrop-blur hover:border-white/50 hover:bg-white/10",
        glow: "bg-gradient-to-r from-brand-600 via-brand-400 to-violet-500 bg-[length:200%_auto] text-white shadow-glow hover:bg-right animate-gradient-x",
      },
      size: {
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-12 px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
