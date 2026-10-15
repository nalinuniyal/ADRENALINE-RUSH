import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlarmClock, ArrowRight, BookOpen, CheckCircle2, Circle, ClipboardList, LayoutDashboard, UserPlus, Users } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { NAV_COLORS, NAV_ICONS } from "@/components/admin/nav-icons";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile, type IconTileColor } from "@/components/ui/icon-tile";
import { requireAccess, type Access } from "@/lib/auth/session";
import { NAV_ITEMS, hasAny } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

const STAGE_READY = new Set(["/admin/courses", "/admin/candidates", "/admin/settings"]);

export default async function DashboardPage() {
  const { access, denied } = await requireAccess(["dashboard.view"]);
  if (denied) return <AccessDenied />;

  const modules = NAV_ITEMS.filter((m) => m.href !== "/admin" && hasAny(access.permissions, m.requires));

  return (
    <>
      <PageHeader
        title={`Welcome back`}
        eyebrow={access.organization.name}
        icon={LayoutDashboard}
        color="sky"
        description={`Live numbers from your database · times shown in ${access.organization.timezone}`}
      />

      <Suspense fallback={<KpiSkeleton />}>
        <Kpis access={access} />
      </Suspense>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<div className="ar-skeleton h-64 rounded-[var(--radius-card)] lg:col-span-2" />}>
          <GettingStarted access={access} />
        </Suspense>

        <Card>
          <CardHeader>
            <CardTitle>Your apps</CardTitle>
            <CardDescription>Modules available to your role.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {modules.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className="ar-lift flex flex-col gap-2 rounded-lg border border-line p-3 text-sm transition hover:border-brand-300"
              >
                <IconTile icon={NAV_ICONS[m.icon]} color={NAV_COLORS[m.icon]} size="sm" />
                <span className="font-medium text-fg">{m.short ?? m.label}</span>
                <span className="text-[11px] text-muted">{STAGE_READY.has(m.href) ? "Ready" : "Coming next"}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

type Kpi = { label: string; value: number | null; icon: typeof Users; color: IconTileColor; href?: string; tone?: "danger" };

async function Kpis({ access }: { access: Access }) {
  const supabase = await createSupabaseServerClient();
  const org = access.organization.id;
  const canCandidates = hasAny(access.permissions, ["candidates.view_all", "candidates.view_assigned"]);
  const canCourses = hasAny(access.permissions, ["courses.view"]);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString();

  const count = async (q: PromiseLike<{ count: number | null; error: unknown }> | null) => {
    if (!q) return null;
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  };

  const [candidates, newThisWeek, registrations, published, overdue] = await Promise.all([
    count(canCandidates ? supabase.from("candidates").select("id", { count: "exact", head: true }).eq("organization_id", org) : null),
    count(canCandidates ? supabase.from("candidates").select("id", { count: "exact", head: true }).eq("organization_id", org).gte("created_at", weekAgo) : null),
    count(canCandidates ? supabase.from("course_registrations").select("id", { count: "exact", head: true }).eq("organization_id", org).gte("created_at", weekAgo) : null),
    count(canCourses ? supabase.from("courses").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "published") : null),
    count(
      canCandidates
        ? supabase.from("follow_up_tasks").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "open").lt("due_at", now.toISOString())
        : null,
    ),
  ]);

  const kpis: Kpi[] = [
    { label: "Candidates", value: candidates, icon: Users, color: "blue", href: "/admin/candidates" },
    { label: "New this week", value: newThisWeek, icon: UserPlus, color: "teal", href: "/admin/candidates?sort=newest" },
    { label: "Registrations (7 days)", value: registrations, icon: ClipboardList, color: "violet" },
    { label: "Published courses", value: published, icon: BookOpen, color: "orange", href: "/admin/courses?status=published" },
    { label: "Overdue follow-ups", value: overdue, icon: AlarmClock, color: "pink", href: "/admin/candidates?followup=overdue", tone: "danger" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {kpis.map((k, i) => {
        const body = (
          <>
            <div className="flex items-center justify-between">
              <IconTile icon={k.icon} color={k.color} size="sm" />
              {k.href ? <ArrowRight className="size-4 text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden /> : null}
            </div>
            <p className={`mt-3 font-display text-3xl font-bold tabular-nums ${k.tone === "danger" && k.value ? "text-danger-700" : "text-ink-900"}`}>
              {k.value === null ? "—" : k.value.toLocaleString("en-IN")}
            </p>
            <p className="text-xs text-muted">{k.label}</p>
          </>
        );
        const cls = "group ar-lift animate-fade-up rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card";
        const style = { animationDelay: `${i * 50}ms` };
        return k.href ? (
          <Link key={k.label} href={k.href} className={cls} style={style}>
            {body}
          </Link>
        ) : (
          <div key={k.label} className={cls} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="ar-skeleton h-[118px] rounded-[var(--radius-card)]" />
      ))}
    </div>
  );
}

async function GettingStarted({ access }: { access: Access }) {
  const supabase = await createSupabaseServerClient();
  const org = access.organization.id;
  const [orgRes, coursesRes, publishedRes, candidatesRes] = await Promise.all([
    supabase.from("organizations").select("contact_email").eq("id", org).single(),
    supabase.from("courses").select("id", { count: "exact", head: true }).eq("organization_id", org),
    supabase.from("courses").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "published"),
    supabase.from("candidates").select("id", { count: "exact", head: true }).eq("organization_id", org),
  ]);

  const steps = [
    { done: true, label: "Business workspace and owner account created" },
    { done: Boolean(orgRes.data?.contact_email), label: "Add your business contact details", href: "/admin/settings" },
    { done: (coursesRes.count ?? 0) > 0, label: "Create your first course", href: "/admin/courses/new" },
    { done: (publishedRes.count ?? 0) > 0, label: "Publish it so the registration page goes live", href: "/admin/courses" },
    { done: (candidatesRes.count ?? 0) > 0, label: "Receive or add your first candidate", href: "/admin/candidates" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Getting started</CardTitle>
        <CardDescription>
          {doneCount} of {steps.length} done. Nothing on this page is sample data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-all duration-700" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
        <ol className="flex flex-col gap-1">
          {steps.map((s) => (
            <li key={s.label}>
              <Link
                href={s.href ?? "/admin"}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm transition hover:bg-brand-50"
                aria-disabled={!s.href}
              >
                {s.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success-700" aria-label="Done" />
                ) : (
                  <Circle className="size-5 shrink-0 text-line-strong" aria-label="Not done" />
                )}
                <span className={s.done ? "text-muted line-through" : "font-medium text-fg"}>{s.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
