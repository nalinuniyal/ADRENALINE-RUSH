"use client";

import type { HTMLAttributes, PointerEvent } from "react";
import { cn } from "@/lib/utils";

/** Container whose background glows where the pointer is. */
export function Spotlight({ className, onPointerMove, ...props }: HTMLAttributes<HTMLDivElement>) {
  const handle = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
    onPointerMove?.(e);
  };
  return <div onPointerMove={handle} className={cn("ar-spotlight", className)} {...props} />;
}
