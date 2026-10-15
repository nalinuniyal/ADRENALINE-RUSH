"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Subtle 3D tilt toward the pointer. Disabled for reduced motion and touch. */
export function Tilt({ children, className, max = 6 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <div
      ref={ref}
      className={cn("transition-transform duration-300 ease-out [transform-style:preserve-3d]", className)}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || reduce() || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        ref.current.style.transform = `perspective(900px) rotateX(${-y * max}deg) rotateY(${x * max}deg)`;
      }}
      onPointerLeave={() => {
        if (ref.current) ref.current.style.transform = "";
      }}
    >
      {children}
    </div>
  );
}
