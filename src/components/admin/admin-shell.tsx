import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut, Search, Settings } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import { AppLauncher, AppNavTabs } from "@/components/admin/sidebar-nav";
import { requireAccess } from "@/lib/auth/session";
import { ROLE_LABELS, visibleNav } from "@/lib/auth/permissions";

function initials(email: string) {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "U";
}

/** Lightning-style console: global header, app navigation bar, sky backdrop. Reads the session, so render inside <Suspense>. */
export async function AdminShell({ children }: { children: ReactNode }) {
  const { access } = await requireAccess();
  const items = visibleNav(access.permissions);
  const canSettings = items.some((i) => i.href === "/admin/settings");

  return (
    <div className="ar-backdrop flex min-h-full flex-1 flex-col">
      <a href="#main" className="sr-only z-[60] rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 shadow-[0_2px_3px_rgb(0_0_0/0.06)] backdrop-blur">
        {/* Global header */}
        <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
          <Link href="/admin" aria-label="Adrenaline Rush home" className="shrink-0">
            <Logo className="hidden sm:inline-flex" />
            <Logo compact className="sm:hidden" />
          </Link>
          <form action="/admin/search" role="search" className="mx-auto hidden w-full max-w-xl md:block">
            <label htmlFor="global-search" className="sr-only">
              Search candidates, courses and batches
            </label>
            <div className="group relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted transition group-focus-within:text-brand-600" aria-hidden />
              <input
                id="global-search"
                name="q"
                type="search"
                placeholder="Search candidates, courses, batches…"
                className="h-8 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm transition-all focus:border-brand-400 focus:ring-[3px] focus:ring-brand-400/25 focus:outline-none"
              />
            </div>
          </form>
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <Link href="/admin/search" className="inline-flex size-9 items-center justify-center rounded-md text-[#444] hover:bg-brand-50 md:hidden" aria-label="Search">
              <Search className="size-[18px]" aria-hidden />
            </Link>
            {canSettings ? (
              <Link href="/admin/settings" className="inline-flex size-9 items-center justify-center rounded-md text-[#444] transition hover:rotate-45 hover:bg-brand-50 hover:text-brand-600" aria-label="Settings" title="Settings">
                <Settings className="size-[18px]" aria-hidden />
              </Link>
            ) : null}
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center rounded-full p-0.5 transition hover:ring-4 hover:ring-brand-100 [&::-webkit-details-marker]:hidden" aria-label="Account menu">
                <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-violet-500 text-xs font-semibold text-white">
                  {initials(access.email)}
                </span>
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-lg border border-line bg-surface p-2 shadow-raised animate-scale-in">
                <div className="px-2 py-2">
                  <p className="truncate text-sm font-semibold">{access.email}</p>
                  <p className="text-xs text-muted">
                    {ROLE_LABELS[access.role]} · {access.organization.name}
                  </p>
                </div>
                <form action={signOut}>
                  <button type="submit" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-canvas" aria-label="Sign out">
                    <LogOut className="size-4" aria-hidden /> Log out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </div>
        {/* App navigation bar */}
        <div className="flex h-10 items-center gap-2 border-t border-line px-2 sm:px-3">
          <AppLauncher items={items} />
          <span className="mr-2 border-r border-line pr-4 font-display text-[15px] font-semibold whitespace-nowrap text-fg">
            {access.organization.name}
          </span>
          <AppNavTabs items={items} />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-4 sm:px-4 sm:py-5">
        {children}
      </main>
    </div>
  );
}

export function AdminShellSkeleton() {
  return (
    <div className="ar-backdrop flex min-h-full flex-1 flex-col" aria-busy="true" aria-label="Loading">
      <div className="h-[89px] border-b border-line bg-surface" />
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5">
        <div className="ar-skeleton h-16 rounded-lg" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ar-skeleton h-28 rounded-lg" />
          ))}
        </div>
        <div className="ar-skeleton mt-4 h-72 rounded-lg" />
      </div>
    </div>
  );
}
