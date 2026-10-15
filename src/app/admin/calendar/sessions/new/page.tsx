import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarPlus } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { isDateString, todayIn } from "@/lib/calendar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/validation/batches";
import { timeZoneList } from "../../../batches/_components/batch-data";
import { sessionFormOptions } from "../../_components/session-data";
import { SessionForm } from "../../_components/session-form";

export const metadata: Metadata = { title: "New session" };

export default function NewSessionPage({ searchParams }: PageProps<"/admin/calendar/sessions/new">) {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <NewSession searchParams={searchParams} />
    </Suspense>
  );
}

async function NewSession({ searchParams }: { searchParams: PageProps<"/admin/calendar/sessions/new">["searchParams"] }) {
  const { access, denied } = await requireAccess(["sessions.manage"]);
  if (denied) return <AccessDenied />;
  const raw = await searchParams;
  const kind = firstParam(raw.kind) === "demo" ? "demo" : "class";
  const supabase = await createSupabaseServerClient();
  const opts = await sessionFormOptions(supabase, access);

  const batch = opts.rawBatches.find((b) => b.id === firstParam(raw.batch));
  const course = opts.courses.find((c) => c.value === firstParam(raw.course));
  const date = firstParam(raw.date);
  const tz = batch?.timezone ?? access.organization.timezone;

  return (
    <>
      <PageHeader
        title={kind === "demo" ? "New demo session" : "New class session"}
        icon={CalendarPlus}
        color="pink"
        crumbs={[{ label: "Calendar", href: "/admin/calendar" }, { label: kind === "demo" ? "New demo session" : "New session" }]}
        description={kind === "demo" ? "A free demo class for a course, without a batch. Invite people who booked a demo." : "One class for a batch. To create a whole schedule, use “Generate classes” on the batch page."}
      />
      <Card>
        <CardContent className="py-5">
          <SessionForm
            initial={{
              kind,
              batchId: kind === "class" ? (batch?.id ?? "") : "",
              courseId: kind === "demo" ? (course?.value ?? "") : "",
              title: kind === "demo" ? "Free demo class" : "",
              date: isDateString(date) ? date : todayIn(tz),
              startTime: "11:00",
              endTime: "12:00",
              timezone: tz,
              instructorId: batch?.instructorId ?? "",
              description: "",
              prepNotes: "",
              notes: "",
              meetingMode: batch?.defaultMeetingUrl ? "manual" : "none",
              meetingUrl: batch?.defaultMeetingUrl ?? "",
              recordingUrl: "",
              status: "scheduled",
              addAttendees: false,
              attendeeIds: [],
            }}
            batches={opts.batches}
            courses={opts.courses}
            instructors={opts.instructors}
            demoPeople={opts.demoPeople}
            google={opts.google}
            canConnectGoogle={opts.canConnectGoogle}
            timeZones={timeZoneList(tz)}
          />
        </CardContent>
      </Card>
    </>
  );
}
