import Link from "next/link";
import { Banknote, CalendarCheck, GraduationCap, Hourglass, type LucideIcon, Percent, Receipt, Scale, UserPlus } from "lucide-react";
import { IconTile, type IconTileColor } from "@/components/ui/icon-tile";
import type { Kpis } from "@/lib/data/analytics";
import type { FinanceSummary } from "@/lib/data/finance";
import { formatPaise } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

type Tile = { key: string; label: string; value: string; hint: string; icon: LucideIcon; color: IconTileColor; tone?: "danger" | "success"; href?: string };

const n = (v: number) => v.toLocaleString("en-IN");

/** Demo → enrollment conversion as "40%" (or "—" with no bookings). */
export function conversion(enrolled: number, booked: number): string {
  if (!booked) return "—";
  return `${Math.round((enrolled / booked) * 100)}%`;
}

export function buildTiles(k: Kpis, money: FinanceSummary | null, q = ""): Tile[] {
  const tiles: Tile[] = [
    { key: "new-leads", label: "New leads", value: n(k.newLeads), hint: "Candidates added in the period", icon: UserPlus, color: "teal", href: "/admin/candidates?sort=newest" },
    { key: "demo-bookings", label: "Demo bookings", value: n(k.demoBookings), hint: "People who requested a demo or were invited to one", icon: CalendarCheck, color: "violet" },
    {
      key: "demo-conversion",
      label: "Demo → enrollment",
      value: conversion(k.demoEnrolled, k.demoBookings),
      hint: k.demoBookings ? `${n(k.demoEnrolled)} of ${n(k.demoBookings)} demo bookings have enrolled` : "No demo bookings in the period",
      icon: Percent,
      color: "indigo",
    },
    { key: "enrollments", label: "Enrollments", value: n(k.enrollments), hint: "New enrollments (cancelled ones left out)", icon: GraduationCap, color: "blue", href: "/admin/batches" },
  ];
  if (money) {
    const cur = money.currency;
    tiles.push(
      { key: "net-collections", label: "Net collections", value: formatPaise(money.net, cur), hint: `${formatPaise(money.gross, cur)} received − ${formatPaise(money.refunds, cur)} refunded`, icon: Banknote, color: "green", href: `/admin/finance${q}` },
      { key: "expenses", label: "Expenses", value: formatPaise(money.expenses, cur), hint: `${n(money.expenseCount)} recorded expense${money.expenseCount === 1 ? "" : "s"}`, icon: Receipt, color: "pink", href: `/admin/finance/expenses${q}` },
      {
        key: "cash-result",
        label: "Cash result",
        value: formatPaise(money.cashResult, cur),
        hint: "Net collections − expenses (not profit)",
        icon: Scale,
        color: "navy",
        tone: money.cashResult < 0 ? "danger" : money.cashResult > 0 ? "success" : undefined,
      },
      { key: "outstanding", label: "Outstanding dues", value: formatPaise(money.outstanding, cur), hint: "Still payable, as of today", icon: Hourglass, color: "orange", href: "/admin/finance/fees" },
    );
  }
  return tiles;
}

export function KpiTiles({ tiles, label = "Key numbers" }: { tiles: Tile[]; label?: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted">{t.label}</p>
              <IconTile icon={t.icon} color={t.color} size="sm" />
            </div>
            <p
              className={cn("mt-1 truncate text-xl font-bold text-ink-900 sm:text-2xl", t.tone === "danger" && "text-danger-700", t.tone === "success" && "text-success-700")}
              data-testid={`analytics-kpi-${t.key}`}
            >
              {t.value}
            </p>
            <p className="mt-0.5 text-xs text-muted">{t.hint}</p>
          </>
        );
        const cls = "min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-card sm:p-4";
        return t.href ? (
          <Link key={t.key} href={t.href} className={cn(cls, "ar-lift transition hover:border-brand-300")}>
            {body}
          </Link>
        ) : (
          <div key={t.key} className={cls}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

export function KpiSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading key numbers">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ar-skeleton h-[104px] rounded-[var(--radius-card)]" />
      ))}
    </div>
  );
}

