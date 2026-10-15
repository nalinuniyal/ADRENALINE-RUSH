import type { ReactNode } from "react";
import { Aurora } from "@/components/fx/aurora";

export function PageHero({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-b from-ink-950 to-ink-900 text-white">
      <Aurora className="opacity-70" />
      <div className="relative mx-auto max-w-6xl px-4 pt-28 pb-14 sm:px-6 sm:pt-32 sm:pb-16">
        {eyebrow ? <p className="animate-fade-up text-sm font-semibold tracking-wider text-volt-400 uppercase">{eyebrow}</p> : null}
        <h1 className="mt-2 max-w-3xl animate-fade-up font-display text-3xl font-bold tracking-tight text-balance [animation-delay:60ms] sm:text-5xl">{title}</h1>
        {children ? <div className="mt-4 max-w-2xl animate-fade-up text-white/70 [animation-delay:120ms]">{children}</div> : null}
      </div>
    </section>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 text-[15px] leading-7 text-[#333] sm:px-6 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink-900 [&_li]:mt-1 [&_p]:mt-4 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
      {children}
    </div>
  );
}
