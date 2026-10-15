import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, PlayCircle } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { addDays } from "@/lib/batches/schedule";
import { addMonths, dayLabel, groupByLocalDate, isDateString, monthGrid, monthLabel, startOfMonth, todayIn, utcRange, weekDays, type CalendarView } from "@/lib/calendar";
import { formatTime } from "@/lib/format";
import { getGoogleStatus } from "@/lib/google/integration";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { firstParam, type SessionStatus } from "@/lib/validation/batches";
import { SessionStatusBadge } from "../batches/_components/badges";
import { MeetingBadge } from "./_components/meeting";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[70vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading calendar" />}>
      <CalendarScreen searchParams={searchParams} />
    </Suspense>
  );
}

type Item = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: SessionStatus;
  kind: string;
  meeting_url: string | null;
  meeting_source: string | null;
  google_sync_status: string;
  label: string;
};

const MAX_IN_CELL = 3;

async function CalendarScreen({ searchParams }: { searchParams: PageProps<"/admin/calendar">["searchParams"] }) {
  const { access, denied } = await requireAccess(["sessions.view"]);
  if (denied) return <AccessDenied />;
  const tz = access.organization.timezone;
  const canManage = access.permissions.includes("sessions.manage");
  const raw = await searchParams;
  const view: CalendarView = firstParam(raw.view) === "week" ? "week" : "month";
  const today = todayIn(tz);
  const date = isDateString(firstParam(raw.date)) ? (firstParam(raw.date) as string) : today;

  const days = view === "month" ? monthGrid(date).flat() : weekDays(date);
  const range = utcRange(days[0], days[days.length - 1], tz);
  const supabase = await createSupabaseServerClient();
  const [res, google] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("id, title, starts_at, ends_at, timezone, status, kind, meeting_url, meeting_source, google_sync_status, batches(name), courses(title)")
      .eq("organization_id", access.organization.id)
      .gte("starts_at", range.from)
      .lt("starts_at", range.to)
      .order("starts_at")
      .limit(1000),
    canManage ? getGoogleStatus(supabase, access.organization.id) : Promise.resolve(null),
  ]);
  if (res.error) {
    console.error(JSON.stringify({ level: "error", msg: "calendar load failed", code: res.error.code }));
    throw new Error("Could not load the calendar.");
  }
  const items: Item[] = (res.data ?? []).map((s) => {
    const batch = Array.isArray(s.batches) ? s.batches[0] : s.batches;
    const course = Array.isArray(s.courses) ? s.courses[0] : s.courses;
    return { ...s, status: s.status as SessionStatus, label: s.kind === "demo" ? `Demo · ${course?.title ?? ""}` : (batch?.name ?? course?.title ?? "") };
  });
  const byDay = groupByLocalDate(items, tz);

  const href = (patch: { view?: CalendarView; date?: string }) => {
    const qs = new URLSearchParams({ view: patch.view ?? view, date: patch.date ?? date });
    return `/admin/calendar?${qs.toString()}`;
  };
  const prev = view === "month" ? addMonths(date, -1) : addDays(date, -7);
  const next = view === "month" ? addMonths(date, 1) : addDays(date, 7);
  const title = view === "month" ? monthLabel(date) : `${dayLabel(days[0], { day: "numeric", month: "short" })} – ${dayLabel(days[6], { day: "numeric", month: "short", year: "numeric" })}`;
  const monthPrefix = startOfMonth(date).slice(0, 7);

  return (
    <>
      <PageHeader
        title="Calendar & Sessions"
        icon={CalendarDays}
        color="pink"
        description={`Classes and demo sessions. Times shown in ${tz}.`}
        actions={
          canManage ? (
            <>
              <Link href="/admin/calendar/sessions/new" className={buttonVariants()}>
                <CalendarPlus className="size-4" aria-hidden /> New session
              </Link>
              <Link href="/admin/calendar/sessions/new?kind=demo" className={buttonVariants({ variant: "secondary" })}>
                <PlayCircle className="size-4" aria-hidden /> Demo session
              </Link>
            </>
          ) : undefined
        }
      />

      {google && google.state !== "connected" && google.state !== "never" ? (
        <Alert tone="warning" className="mb-4" title="Google Calendar needs attention">
          {google.lastError ?? "Google is disconnected."} New Meet links cannot be created until you{" "}
          <Link href="/admin/settings#integrations" className="font-semibold underline">
            reconnect Google
          </Link>
          . Pasted links keep working.
        </Alert>
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2">
            <Link href={href({ date: prev })} className={buttonVariants({ variant: "secondary", size: "icon" })} aria-label={view === "month" ? "Previous month" : "Previous week"}>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
            <Link href={href({ date: today })} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Today
            </Link>
            <Link href={href({ date: next })} className={buttonVariants({ variant: "secondary", size: "icon" })} aria-label={view === "month" ? "Next month" : "Next week"}>
              <ChevronRight className="size-4" aria-hidden />
            </Link>
            <h2 className="ml-1 text-base font-bold" aria-live="polite">
              {title}
            </h2>
          </div>
          <nav aria-label="Calendar view" className="inline-flex overflow-hidden rounded-md border border-line-strong text-sm">
            {(["month", "week"] as const).map((v) => (
              <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined} className={cn("px-3 py-1.5", view === v ? "bg-brand-600 text-white" : "text-brand-700 hover:bg-brand-50")}>
                {v === "month" ? "Month" : "Week"}
              </Link>
            ))}
          </nav>
        </div>
      </Card>

      {view === "month" ? (
        <>
          <Card className="hidden overflow-hidden sm:block">
            <div className="grid grid-cols-7 border-b border-line bg-canvas/60 text-center text-xs font-medium text-muted uppercase" aria-hidden>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = byDay.get(d) ?? [];
                const inMonth = d.startsWith(monthPrefix);
                return (
                  <div key={d} className={cn("min-h-28 border-r border-b border-line p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-canvas/50")}>
                    <Link
                      href={href({ view: "week", date: d })}
                      className={cn("mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs", d === today ? "bg-brand-600 font-bold text-white" : inMonth ? "text-fg hover:bg-brand-50" : "text-muted")}
                      aria-label={`${dayLabel(d, { weekday: "long", day: "numeric", month: "long" })}${list.length ? `, ${list.length} session${list.length === 1 ? "" : "s"}` : ""}`}
                    >
                      {Number(d.slice(8))}
                    </Link>
                    <ul className="grid gap-1">
                      {list.slice(0, MAX_IN_CELL).map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/admin/calendar/sessions/${s.id}`}
                            className={cn(
                              "block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight",
                              s.status === "cancelled" ? "bg-[#ecebea] text-muted line-through" : s.kind === "demo" ? "bg-[#f2e9fd] text-[#6b2ec2] hover:bg-[#e5d4fb]" : "bg-brand-50 text-brand-800 hover:bg-brand-100",
                            )}
                            title={`${formatTime(s.starts_at, tz)} ${s.title} · ${s.label}`}
                          >
                            <span className="font-semibold">{formatTime(s.starts_at, tz)}</span> {s.title}
                          </Link>
                        </li>
                      ))}
                      {list.length > MAX_IN_CELL ? (
                        <li>
                          <Link href={href({ view: "week", date: d })} className="text-[11px] font-medium text-brand-700 hover:underline">
                            +{list.length - MAX_IN_CELL} more
                          </Link>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
          {/* Phones: the month as an agenda */}
          <div className="sm:hidden">
            <Agenda days={days.filter((d) => d.startsWith(monthPrefix))} byDay={byDay} tz={tz} today={today} hideEmpty />
          </div>
        </>
      ) : (
        <Agenda days={days} byDay={byDay} tz={tz} today={today} />
      )}

      {items.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted">
          No sessions in this {view}.{canManage ? " Generate a batch’s classes from its page, or add a session." : ""}
        </p>
      ) : null}
    </>
  );
}

function Agenda({ days, byDay, tz, today, hideEmpty = false }: { days: string[]; byDay: Map<string, Item[]>; tz: string; today: string; hideEmpty?: boolean }) {
  const shown = hideEmpty ? days.filter((d) => byDay.get(d)?.length) : days;
  if (!shown.length) return null;
  return (
    <Card className="overflow-hidden">
      <ol className="divide-y divide-line">
        {shown.map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <li key={d} className={cn("grid gap-2 px-4 py-3 sm:grid-cols-[9rem_1fr]", d === today && "bg-brand-50/40")}>
              <h3 className={cn("text-sm font-semibold", d === today ? "text-brand-700" : "text-fg")}>
                {dayLabel(d)}
                {d === today ? <span className="ml-1 text-xs font-normal">(today)</span> : null}
              </h3>
              {list.length === 0 ? (
                <p className="text-sm text-muted">No sessions</p>
              ) : (
                <ul className="grid gap-2">
                  {list.map((s) => (
                    <li key={s.id} className="relative flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 transition hover:border-brand-300">
                      <div className="min-w-0">
                        <Link href={`/admin/calendar/sessions/${s.id}`} className={cn("font-medium text-brand-700 after:absolute after:inset-0 hover:underline", s.status === "cancelled" && "line-through")}>
                          {s.title}
                        </Link>
                        <p className="text-xs text-muted">
                          {formatTime(s.starts_at, tz)}–{formatTime(s.ends_at, tz)}
                          {s.timezone !== tz ? ` (${formatTime(s.starts_at, s.timezone)} ${s.timezone})` : ""} · {s.label}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {s.status !== "scheduled" ? <SessionStatusBadge status={s.status} /> : null}
                        <MeetingBadge source={s.meeting_source} url={s.meeting_url} syncStatus={s.google_sync_status} compact />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
