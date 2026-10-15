"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Transparent over the hero, turns into frosted glass once you scroll. */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        scrolled ? "border-b border-white/10 bg-ink-950/75 shadow-lg backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Adrenaline Rush home">
          <Logo inverse />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          <Link href="/courses" className="rounded-md px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white">
            Courses
          </Link>
          <Link href="/about" className="hidden rounded-md px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white sm:block">
            About
          </Link>
          <Link href="/#contact" className={buttonVariants({ variant: "inverse", size: "sm" })}>
            Get in touch
          </Link>
        </nav>
      </div>
    </header>
  );
}
