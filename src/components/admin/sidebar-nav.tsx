"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Grip, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NAV_COLORS, NAV_ICONS } from "@/components/admin/nav-icons";
import { IconTile } from "@/components/ui/icon-tile";
import type { NavItem } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Lightning-style app navigation bar: tabs with an animated active underline. */
export function AppNavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden min-w-0 flex-1 lg:block">
      <ul className="flex h-10 items-stretch overflow-x-auto [scrollbar-width:none]">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center px-3 text-[13px] whitespace-nowrap transition-colors",
                  active ? "font-semibold text-fg" : "text-[#444] hover:bg-brand-50/70 hover:text-fg",
                )}
              >
                {item.short ?? item.label}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 bottom-0 h-[3px] origin-center rounded-t bg-brand-600 transition-transform duration-300 ease-out",
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50 group-hover:bg-brand-300",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** App launcher (waffle) that opens a module grid; also the mobile navigation. */
export function AppLauncher({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-9 items-center justify-center rounded-md text-[#444] transition hover:bg-brand-50 hover:text-brand-600"
        aria-label="App launcher"
        aria-expanded={open}
        aria-controls="app-launcher"
      >
        <Grip className="size-5" aria-hidden />
      </button>
      {/* Portal to <body>: the header's backdrop blur would otherwise trap this fixed panel inside the header. */}
      {open
        ? createPortal(
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="App launcher" id="app-launcher">
          <button type="button" className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-80 max-w-[88vw] flex-col bg-surface shadow-2xl animate-slide-in-left">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Logo />
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-canvas" aria-label="Close app launcher">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <p className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">All items</p>
            <nav aria-label="Main" className="overflow-y-auto px-2 pb-4" key={pathname}>
              <ul className="flex flex-col gap-0.5">
                {items.map((item, i) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href} className="animate-fade-in" style={{ animationDelay: `${i * 25}ms` }}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                          active ? "bg-brand-50 font-semibold text-brand-700" : "text-fg hover:bg-canvas",
                        )}
                      >
                        <IconTile icon={NAV_ICONS[item.icon]} color={NAV_COLORS[item.icon]} size="sm" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
