import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { History, PlayCircle, Plus } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { getMemberNames } from "@/lib/data/candidates";
import { siteUrl } from "@/lib/email/automations";
import { emailConfig } from "@/lib/email/config";
import { todayIn } from "@/lib/resources/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResourcesHeader, ResourcesSkeleton } from "../_components/resources-header";
import { loadShares, ShareHistoryList } from "../_components/share-history";
import { ShareComposer } from "./share-composer";

export const metadata: Metadata = { title: "Share demos and resources" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(v: string | string[] | undefined, max: number): string[] {
  const list = (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(",")).filter((s) => UUID_RE.test(s));
  return [...new Set(list)].slice(0, max);
}

export default function SharePage({ searchParams }: PageProps<"/admin/resources/share">) {
  return (
    <Suspense fallback={<ResourcesSkeleton label="Loading share screen" />}>
      <Share searchParams={searchParams} />
    </Suspense>
  );
}

async function Share({ searchParams }: { searchParams: PageProps<"/admin/resources/share">["searchParams"] }) {
  const { access, denied } = await requireAccess(["resources.share"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const tz = access.organization.timezone;
  const raw = await searchParams;
  const candidateIds = ids(raw.candidate, 50);
  const resourceIds = ids(raw.resource, 20);
  const supabase = await createSupabaseServerClient();
  const today = todayIn(tz);

  const [resourcesRes, templatesRes, coursesRes, candidatesRes, regsRes, settingsRes, profileRes] = await Promise.all([
    supabase
      .from("resources")
      .select("id, title, slug, url, type, resource_courses(course_id)")
      .eq("organization_id", orgId)
      .eq("visibility", "shareable")
      .eq("is_active", true)
      .or(`expires_on.is.null,expires_on.gte.${today}`)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase.from("share_templates").select("id, name, channel, subject, body").eq("organization_id", orgId).order("position").order("name"),
    supabase.from("courses").select("id, title, slug, status").eq("organization_id", orgId).neq("status", "archived").order("title"),
    candidateIds.length
      ? supabase.from("candidates").select("id, full_name, email, phone, do_not_contact, marketing_consent").eq("organization_id", orgId).in("id", candidateIds)
      : Promise.resolve({ data: [], error: null }),
    candidateIds.length === 1
      ? supabase.from("course_registrations").select("course_id").eq("candidate_id", candidateIds[0]).not("course_id", "is", null).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] as { course_id: string | null }[], error: null }),
    supabase.from("sharing_settings").select("whatsapp_country_code").eq("organization_id", orgId).maybeSingle(),
    supabase.from("user_profiles").select("full_name").eq("id", access.userId).maybeSingle(),
  ]);
  if (resourcesRes.error || templatesRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "share screen load failed", code: (resourcesRes.error ?? templatesRes.error)?.code }));
    throw new Error("Could not load the share screen. If you just updated the app, run the latest supabase/setup.sql.");
  }

  const resources = (resourcesRes.data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    url: r.url,
    type: r.type,
    courseIds: ((r.resource_courses as unknown as { course_id: string }[] | null) ?? []).map((c) => c.course_id),
  }));
  const courses = coursesRes.data ?? [];
  const preselected = resourceIds.filter((id) => resources.some((r) => r.id === id));
  const firstCourse = resources.find((r) => preselected.includes(r.id))?.courseIds[0];
  const registeredCourse = regsRes.data?.[0]?.course_id ?? undefined;
  const defaultCourseId = [firstCourse, registeredCourse].find((id) => id && courses.some((c) => c.id === id)) ?? "";
  const single = candidatesRes.data?.length === 1 ? candidatesRes.data[0] : null;

  const [members, history] = single
    ? await Promise.all([getMemberNames(supabase, orgId), loadShares(supabase, orgId, { candidateId: single.id, limit: 10 })])
    : [null, null];

  return (
    <>
      <ResourcesHeader
        active="share"
        title={single ? `Share with ${single.full_name}` : "Share demos and resources"}
        crumbs={single ? [{ label: "Candidates", href: "/admin/candidates" }, { label: single.full_name, href: `/admin/candidates/${single.id}` }, { label: "Share" }] : undefined}
        description="Choose who and what, pick a message, check the preview, then copy it, open WhatsApp or send it by email. Every share is recorded on the candidate’s timeline."
      />
      {resources.length === 0 ? (
        <EmptyState
          icon={<PlayCircle className="size-6" aria-hidden />}
          title="Nothing to share yet"
          description="Only resources marked “Shareable” and switched on can be shared. Add one, or open an existing resource and make it shareable."
          action={
            access.permissions.includes("resources.manage") ? (
              <Link href="/admin/resources/new" className={buttonVariants()}>
                <Plus className="size-4" aria-hidden /> New resource
              </Link>
            ) : (
              <Link href="/admin/resources" className={buttonVariants({ variant: "secondary" })}>
                Open the library
              </Link>
            )
          }
        />
      ) : (
        <ShareComposer
          resources={resources}
          templates={templatesRes.data ?? []}
          courses={courses}
          initialCandidates={candidatesRes.data ?? []}
          initialResourceIds={preselected}
          defaultCourseId={defaultCourseId}
          siteUrl={siteUrl()}
          businessName={access.organization.name}
          senderName={profileRes.data?.full_name?.trim() || access.organization.name}
          countryCode={settingsRes.data?.whatsapp_country_code ?? "91"}
          emailConfigured={emailConfig().provider !== null}
          canMarkStatus={access.permissions.includes("candidates.manage")}
        />
      )}
      {single && history && members ? (
        <Card className="mt-4">
          <CardHeader icon={<IconTile icon={History} color="violet" size="sm" />}>
            <CardTitle>Shared with {single.full_name} before</CardTitle>
            {history.total ? <CardDescription>{`${history.total} share${history.total === 1 ? "" : "s"}`}</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <ShareHistoryList rows={history.rows} members={members} timeZone={tz} showCandidate={false} />
            {history.total > history.rows.length ? (
              <Link href={`/admin/resources/history?candidate=${single.id}`} className="mt-2 inline-block text-sm text-brand-700 hover:underline">
                See all {history.total}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
