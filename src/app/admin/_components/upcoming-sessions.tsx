import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import type { Access } from "@/lib/auth/session";
import { formatDate, formatTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MeetingBadge } from "../calendar/_components/meeting";

/** Dashboard card: the next sessions the user can see. */
export async function UpcomingSessions({ access }: { access: Access }) {
  if (!access.permissions.includes("sessions.view")) return null;
  const tz = access.organization.timezone;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("class_sessions")
    .select("id, title, kind, starts_at, ends_at, meeting_url, meeting_source, google_sync_status, batches(name), courses(title)")
    .eq("organization_id", access.organization.id)
    .eq("status", "scheduled")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at")
    .limit(5);
  const sessions = data ?? [];

  return (
    <Card className="mt-4">
      <CardHeader
        icon={<IconTile icon={CalendarDays} color="pink" size="sm" />}
        actions={
          <Link href="/admin/calendar?view=week" className="text-sm font-medium text-brand-700 hover:underline">
            Calendar
          </Link>
        }
      >
        <CardTitle>Upcoming sessions</CardTitle>
        <CardDescription>Times in {tz}.</CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted">Nothing scheduled.</p>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => {
              const batch = Array.isArray(s.batches) ? s.batches[0] : s.batches;
              const course = Array.isArray(s.courses) ? s.courses[0] : s.courses;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={`/admin/calendar/sessions/${s.id}`} className="font-medium text-brand-700 hover:underline">
                      {s.title}
                    </Link>
                    <p className="text-xs text-muted">
                      {formatDate(s.starts_at, tz)} · {formatTime(s.starts_at, tz)} · {s.kind === "demo" ? `Demo · ${course?.title ?? ""}` : (batch?.name ?? course?.title)}
                    </p>
                  </div>
                  <MeetingBadge source={s.meeting_source} url={s.meeting_url} syncStatus={s.google_sync_status} compact />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
