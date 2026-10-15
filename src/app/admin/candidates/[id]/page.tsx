import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  AlarmClock,
  ArrowRightLeft,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CircleDot,
  FileUp,
  GraduationCap,
  type LucideIcon,
  MessageSquareText,
  PlayCircle,
  Share2,
  StickyNote,
  UserPlus,
  UserRound,
} from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { getCandidateOwners, getLeadStatuses, getMemberNames } from "@/lib/data/candidates";
import { formatDate, formatDateTime, utcToZonedParts } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { CandidateFormValues } from "../_components/candidate-form";
import { EditableDetails, FollowUpForm, NoteForm, OwnerSelect, StatusPath, TaskActions } from "../_components/profile-actions";
import { personName, StatusBadge } from "../_components/status-badge";

export const metadata: Metadata = { title: "Candidate" };

export default function CandidatePage({ params }: PageProps<"/admin/candidates/[id]">) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <CandidateProfile params={params} />
    </Suspense>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  registered: GraduationCap,
  demo_requested: PlayCircle,
  status_changed: ArrowRightLeft,
  note_added: StickyNote,
  follow_up_created: CalendarClock,
  follow_up_done: CalendarCheck,
  imported: FileUp,
  created: UserPlus,
  owner_changed: UserRound,
  resource_shared: Share2,
};

async function CandidateProfile({ params }: { params: PageProps<"/admin/candidates/[id]">["params"] }) {
  const { access, denied } = await requireAccess(["candidates.view_all", "candidates.view_assigned"]);
  if (denied) return <AccessDenied />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const canManage = access.permissions.includes("candidates.manage");
  const canReassign = canManage && access.permissions.includes("candidates.view_all");
  const supabase = await createSupabaseServerClient();

  // RLS returns nothing for candidates this user may not see: same response as a missing record.
  const { data: c, error } = await supabase.from("candidates").select("*").eq("id", id).eq("organization_id", orgId).maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "candidate load failed", code: error.code }));
    throw new Error("Could not load this candidate.");
  }
  if (!c) notFound();

  const [statuses, owners, members, regsRes, notesRes, tasksRes, activitiesRes] = await Promise.all([
    getLeadStatuses(supabase, orgId),
    canManage ? getCandidateOwners(supabase, orgId) : Promise.resolve([]),
    getMemberNames(supabase, orgId),
    supabase
      .from("course_registrations")
      .select("id, course_id, answers, channel, created_at, duplicate_reason, utm_source, utm_campaign, course:courses(title, slug)")
      .eq("candidate_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("candidate_notes").select("id, body, author_id, created_at").eq("candidate_id", id).order("created_at", { ascending: false }).limit(100),
    supabase
      .from("follow_up_tasks")
      .select("id, title, notes, due_at, status, assigned_to, completed_at")
      .eq("candidate_id", id)
      .order("due_at", { ascending: true })
      .limit(100),
    supabase.from("candidate_activities").select("id, type, summary, details, actor_id, created_at").eq("candidate_id", id).order("created_at", { ascending: false }).limit(100),
  ]);

  const regs = regsRes.data ?? [];
  const courseIds = [...new Set(regs.map((r) => r.course_id).filter((v): v is string => Boolean(v)))];
  const fieldsRes = courseIds.length
    ? await supabase.from("course_registration_fields").select("course_id, key, label").in("course_id", courseIds)
    : { data: [] as { course_id: string; key: string; label: string }[] };
  const fieldLabel = new Map((fieldsRes.data ?? []).map((f) => [`${f.course_id}:${f.key}`, f.label]));

  const notes = notesRes.data ?? [];
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const tasks = tasksRes.data ?? [];
  const openTasks = tasks.filter((t) => t.status === "open");
  const closedTasks = tasks.filter((t) => t.status !== "open").reverse().slice(0, 10);
  const activities = activitiesRes.data ?? [];
  const status = statuses.find((s) => s.id === c.lead_status_id);
  const now = new Date().getTime();
  // Default new follow-ups to tomorrow so they are not overdue the moment they are saved.
  const tomorrow = utcToZonedParts(new Date(now + 864e5).toISOString(), tz).date;
  const ownerOptions = owners.map((o) => ({ value: o.user_id, label: o.user_id === access.userId ? `${o.full_name || o.email} (me)` : o.full_name || o.email }));
  const followUpOwners = canReassign ? ownerOptions : ownerOptions.filter((o) => o.value === access.userId);

  const initial: CandidateFormValues = {
    fullName: c.full_name,
    email: c.email ?? "",
    phone: c.phone ?? "",
    company: c.company ?? "",
    jobTitle: c.job_title ?? "",
    city: c.city ?? "",
    country: c.country ?? "",
    totalExperienceYears: c.total_experience_years?.toString() ?? "",
    relevantExperienceYears: c.relevant_experience_years?.toString() ?? "",
    skills: c.skills ?? "",
    interests: c.interests ?? "",
    learningObjectives: c.learning_objectives ?? "",
    preferredSchedule: c.preferred_schedule ?? "",
    preferredDeliveryMode: c.preferred_delivery_mode ?? "",
    employmentStatus: c.employment_status ?? "",
    heardAbout: c.heard_about ?? "",
    source: c.source ?? "",
    utmSource: c.utm_source ?? "",
    utmMedium: c.utm_medium ?? "",
    utmCampaign: c.utm_campaign ?? "",
    marketingConsent: c.marketing_consent,
    privacyConsent: Boolean(c.privacy_consent_at),
    doNotContact: c.do_not_contact,
  };

  const detailRows: { label: string; value: React.ReactNode }[] = [
    { label: "Email", value: c.email ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{c.email}</a> : null },
    { label: "Phone", value: c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="text-brand-700 hover:underline">{c.phone}</a> : null },
    { label: "Company", value: c.company },
    { label: "Job title", value: c.job_title },
    { label: "City", value: c.city },
    { label: "Country", value: c.country },
    { label: "Total experience", value: c.total_experience_years != null ? `${c.total_experience_years} years` : null },
    { label: "Relevant experience", value: c.relevant_experience_years != null ? `${c.relevant_experience_years} years` : null },
    { label: "Employment status", value: c.employment_status },
    { label: "Preferred schedule", value: c.preferred_schedule },
    { label: "Preferred delivery", value: c.preferred_delivery_mode },
    { label: "Heard about us", value: c.heard_about },
    { label: "Skills", value: c.skills },
    { label: "Interests", value: c.interests },
    { label: "Learning objectives", value: c.learning_objectives },
    { label: "Source", value: c.source },
    { label: "UTM", value: [c.utm_source, c.utm_medium, c.utm_campaign, c.utm_content].filter(Boolean).join(" / ") || null },
    { label: "Referrer", value: c.referrer },
    { label: "Privacy consent", value: c.privacy_consent_at ? `Given ${formatDateTime(c.privacy_consent_at, tz)}` : "Not recorded" },
    { label: "Marketing consent", value: c.marketing_consent ? "Yes" : "No" },
  ];

  return (
    <>
      <PageHeader
        icon={UserRound}
        color="orange"
        crumbs={[{ label: "Candidates", href: "/admin/candidates" }, { label: c.full_name }]}
        title={c.full_name}
        description={[c.job_title, c.company].filter(Boolean).join(" at ") || undefined}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={status} />
            {c.do_not_contact ? <Badge tone="danger">Do not contact</Badge> : null}
            {c.marketing_consent && !c.do_not_contact ? <Badge tone="success">Marketing opt-in</Badge> : null}
          </div>
        }
        details={[
          { label: "Owner", value: personName(members, c.owner_id) },
          { label: "Created", value: formatDate(c.created_at, tz) },
          { label: "Last activity", value: c.last_activity_at ? formatDateTime(c.last_activity_at, tz) : "—" },
          { label: "Source", value: c.utm_source ?? c.source ?? "—" },
        ]}
      />

      <StatusPath
        candidateId={c.id}
        statuses={statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, is_closed: s.is_closed }))}
        currentId={c.lead_status_id}
        canEdit={canManage}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader icon={<IconTile icon={UserRound} color="orange" size="sm" />}>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <EditableDetails candidateId={c.id} initial={initial} canEdit={canManage}>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {detailRows.map((d) => (
                    <div key={d.label} className="min-w-0 border-b border-line pb-2">
                      <dt className="text-xs text-muted">{d.label}</dt>
                      <dd className="text-sm break-words whitespace-pre-line">{d.value || <span className="text-muted">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              </EditableDetails>
            </CardContent>
          </Card>

          <Card>
            <CardHeader icon={<IconTile icon={BookOpen} color="violet" size="sm" />}>
              <CardTitle>Course registrations ({regs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {regs.length === 0 ? (
                <p className="text-sm text-muted">No course registrations yet.</p>
              ) : (
                <ul className="grid gap-3">
                  {regs.map((r) => {
                    const course = Array.isArray(r.course) ? r.course[0] : r.course;
                    const answers = Object.entries((r.answers ?? {}) as Record<string, unknown>).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
                    return (
                      <li key={r.id} className="rounded-lg border border-line p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold">{course?.title ?? "Deleted course"}</p>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone="brand">{CHANNEL_LABELS[r.channel] ?? r.channel}</Badge>
                            {r.duplicate_reason ? <Badge tone="warning">Repeat registration</Badge> : null}
                          </div>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatDateTime(r.created_at, tz)}
                          {r.utm_source ? ` · ${r.utm_source}${r.utm_campaign ? ` / ${r.utm_campaign}` : ""}` : ""}
                        </p>
                        {answers.length ? (
                          <dl className="mt-2 grid gap-2 border-t border-line pt-2 text-sm sm:grid-cols-2">
                            {answers.map(([k, v]) => (
                              <div key={k} className="min-w-0">
                                <dt className="text-xs text-muted">{fieldLabel.get(`${r.course_id}:${k}`) ?? humanize(k)}</dt>
                                <dd className="break-words">{formatAnswer(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader icon={<IconTile icon={CircleDot} color="teal" size="sm" />}>
              <CardTitle>Activity</CardTitle>
              <CardDescription>Registrations, status changes, notes and follow-ups, newest first.</CardDescription>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-sm text-muted">No activity yet.</p>
              ) : (
                <ol className="relative grid gap-4 border-l border-line pl-5">
                  {activities.map((a) => {
                    const Icon = ACTIVITY_ICONS[a.type] ?? CircleDot;
                    const details = (a.details ?? {}) as Record<string, unknown>;
                    const note = a.type === "note_added" && typeof details.note_id === "string" ? noteById.get(details.note_id) : undefined;
                    return (
                      <li key={a.id} className="relative">
                        <span className="absolute top-0.5 -left-[31px] flex size-5 items-center justify-center rounded-full border border-line bg-surface text-brand-600">
                          <Icon className="size-3" aria-hidden />
                        </span>
                        <p className="text-sm font-medium">{a.summary}</p>
                        {note ? <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-[#444]">{note.body}</p> : null}
                        <p className="text-xs text-muted">
                          {formatDateTime(a.created_at, tz)}
                          {a.actor_id ? ` · ${personName(members, a.actor_id, "System")}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          {canReassign ? (
            <Card>
              <CardHeader icon={<IconTile icon={UserRound} color="navy" size="sm" />}>
                <CardTitle>Owner</CardTitle>
                <CardDescription>Only team members who can manage candidates are listed.</CardDescription>
              </CardHeader>
              <CardContent>
                <OwnerSelect candidateId={c.id} ownerId={c.owner_id} owners={ownerOptions} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader icon={<IconTile icon={AlarmClock} color="pink" size="sm" />}>
              <CardTitle>Follow-ups</CardTitle>
              <CardDescription>Times in {tz}.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {openTasks.length === 0 ? <p className="text-sm text-muted">No open follow-ups.</p> : null}
              {openTasks.length ? (
                <ul className="grid gap-2">
                  {openTasks.map((t) => {
                    const overdue = new Date(t.due_at).getTime() < now;
                    return (
                      <li key={t.id} className={cn("flex items-start justify-between gap-3 rounded-lg border p-3", overdue ? "border-danger-700/30 bg-danger-50" : "border-line")}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium break-words">{t.title}</p>
                          <p className={cn("text-xs", overdue ? "font-semibold text-danger-700" : "text-muted")}>
                            {overdue ? "Overdue · " : ""}
                            {formatDateTime(t.due_at, tz)}
                          </p>
                          <p className="text-xs text-muted">{personName(members, t.assigned_to)}</p>
                          {t.notes ? <p className="mt-1 text-xs whitespace-pre-line text-[#444]">{t.notes}</p> : null}
                        </div>
                        {canManage ? <TaskActions taskId={t.id} status={t.status} title={t.title} /> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {canManage ? (
                <div className="border-t border-line pt-4">
                  <FollowUpForm candidateId={c.id} defaultDate={tomorrow} timeZone={tz} owners={followUpOwners} currentUserId={access.userId} />
                </div>
              ) : null}
              {closedTasks.length ? (
                <details className="border-t border-line pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">Completed and cancelled ({closedTasks.length})</summary>
                  <ul className="mt-2 grid gap-2">
                    {closedTasks.map((t) => (
                      <li key={t.id} className="flex items-start justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className={cn("break-words", t.status === "cancelled" && "line-through text-muted")}>{t.title}</p>
                          <p className="text-xs text-muted">
                            {t.status === "done" ? `Done ${formatDateTime(t.completed_at ?? t.due_at, tz)}` : "Cancelled"}
                          </p>
                        </div>
                        {canManage ? <TaskActions taskId={t.id} status={t.status} title={t.title} /> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader icon={<IconTile icon={MessageSquareText} color="sky" size="sm" />}>
              <CardTitle>Notes ({notes.length})</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {canManage ? <NoteForm candidateId={c.id} /> : null}
              {notes.length === 0 ? (
                <p className="text-sm text-muted">No notes yet.</p>
              ) : (
                <ul className="grid gap-3">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-lg bg-canvas p-3">
                      <p className="text-sm break-words whitespace-pre-line">{n.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {personName(members, n.author_id, "Unknown")} · {formatDateTime(n.created_at, tz)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted">
            <Link href="/admin/candidates" className="hover:text-brand-700 hover:underline">← Back to candidates</Link>
          </p>
        </div>
      </div>
    </>
  );
}

const CHANNEL_LABELS: Record<string, string> = {
  public_form: "Website form",
  demo_request: "Demo request",
  import: "Import",
  manual: "Added by staff",
};

function humanize(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatAnswer(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function ProfileSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading candidate">
      <div className="ar-skeleton h-28 rounded-[var(--radius-card)]" />
      <div className="ar-skeleton h-14 rounded-[var(--radius-card)]" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="ar-skeleton h-96 rounded-[var(--radius-card)] lg:col-span-2" />
        <div className="ar-skeleton h-96 rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}
