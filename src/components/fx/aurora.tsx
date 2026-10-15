import { cn } from "@/lib/utils";

/** Animated aurora + perspective grid backdrop for dark hero sections (pure CSS). */
export function Aurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="absolute -top-1/3 -left-1/4 size-[70vmax] animate-aurora rounded-full bg-[radial-gradient(circle_at_center,rgb(27_150_255/0.45),transparent_60%)] blur-3xl" />
      <div className="absolute -right-1/4 -bottom-1/2 size-[60vmax] animate-aurora rounded-full bg-[radial-gradient(circle_at_center,rgb(144_80_233/0.35),transparent_60%)] blur-3xl [animation-delay:-6s]" />
      <div className="absolute top-1/4 left-1/2 size-[40vmax] animate-aurora rounded-full bg-[radial-gradient(circle_at_center,rgb(6_165_154/0.25),transparent_60%)] blur-3xl [animation-delay:-11s]" />
      <div className="ar-grid-bg absolute inset-x-0 bottom-0 h-2/3 animate-grid-pan [mask-image:linear-gradient(to_top,black,transparent)] [transform:perspective(600px)_rotateX(55deg)] origin-bottom" />
    </div>
  );
}
