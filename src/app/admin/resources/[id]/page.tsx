import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink, Globe, History, Send } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { getMemberNames } from "@/lib/data/candidates";
import { siteUrl } from "@/lib/email/automations";
import { resourceLink } from "@/lib/resources/message";
import { isShareable, todayIn, type ResourceType } from "@/lib/resources/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CopyButton } from "../_components/copy-button";
import { VisibilityBadges } from "../_components/resource-badges";
import { ResourceActions } from "../_components/resource-actions";
import { ResourceForm } from "../_components/resource-form";
import { ResourcesHeader, ResourcesSkeleton } from "../_components/resources-header";
import { loadShares, ShareHistoryList } from "../_components/share-history";

export const metadata: Metadata = { title: "Resource" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ResourcePage({ params, searchParams }: PageProps<"/admin/resources/[id]">) {
  return (
    <Suspense fallback={<ResourcesSkeleton label="Loading resource" />}>
      <ResourceDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ResourceDetail({ params, searchParams }: { params: PageProps<"/admin/resources/[id]">["params"]; searchParams: PageProps<"/admin/resources/[id]">["searchParams"] }) {
  const { access, denied } = await requireAccess(["resources.view"]);
  if (denied) return <AccessDenied />;
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const created = (await searchParams).created === "1";
  const orgId = access.organization.id;
  const canManage = access.permissions.includes("resources.manage");
  const canShare = access.permissions.includes("resources.share");
  const tz = access.organization.timezone;
  const supabase = await createSupabaseServerClient();

  const { data: r, error } = await supabase
    .from("resources")
    .select("id, title, slug, type, url, description, thumbnail_url, visibility, is_active, access_instructions, expires_on, resource_courses(course_id)")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "resource load failed", code: error.code }));
    throw new Error("Could not load this resource.");
  }
  if (!r) notFound();

  const [coursesRes, shares, members, countsRes] = await Promise.all([
    supabase.from("courses").select("id, title, status").eq("organization_id", orgId).order("title"),
    loadShares(supabase, orgId, { resourceId: id, limit: 25 }),
    getMemberNames(supabase, orgId),
    supabase.rpc("resource_share_counts", { p_org: orgId }),
  ]);
  const courseIds = ((r.resource_courses as unknown as { course_id: string }[] | null) ?? []).map((c) => c.course_id);
  const courses = (coursesRes.data ?? []).filter((c) => c.status !== "archived" || courseIds.includes(c.id));
  const shareCount = Number((countsRes.data ?? []).find((c) => c.resource_id === id)?.shares ?? 0);
  const today = todayIn(tz);
  const shareable = isShareable(r, today);
  const publicUrl = resourceLink({ id: r.id, title: r.title, slug: r.slug, url: r.url }, siteUrl());

  return (
    <>
      <ResourcesHeader
        active={null}
        title={r.title}
        crumbs={[{ label: "Demos & Resources", href: "/admin/resources" }, { label: r.title }]}
        actions={canManage ? <ResourceActions resourceId={r.id} isActive={r.is_active} shares={shareCount} /> : undefined}
      />
      {created ? (
        <Alert tone="success" className="mb-4" title="Resource saved">
          {shareable ? "Share it from here, from the library or from a candidate’s profile." : "It is internal only, so it is not shared with candidates."}
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
            {!canManage ? <CardDescription>You can view this resource but not change it.</CardDescription> : null}
          </CardHeader>
          <CardContent>
            <ResourceForm
              resourceId={r.id}
              courses={courses}
              readOnly={!canManage}
              initial={{
                title: r.title,
                type: r.type as ResourceType,
                url: r.url,
                description: r.description ?? "",
                thumbnailUrl: r.thumbnail_url ?? "",
                visibility: r.visibility === "shareable" ? "shareable" : "internal",
                isActive: r.is_active,
                accessInstructions: r.access_instructions ?? "",
                expiresOn: r.expires_on ?? "",
                courseIds,
              }}
            />
          </CardContent>
        </Card>

        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader icon={<IconTile icon={Globe} color="teal" size="sm" />}>
              <CardTitle>Public page</CardTitle>
              <CardDescription>
                <span className="flex flex-wrap gap-1.5 pt-1">
                  <VisibilityBadges visibility={r.visibility} isActive={r.is_active} expiresOn={r.expires_on} today={today} />
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {shareable ? (
                <>
                  <p className="text-sm break-all text-[#444]">{publicUrl}</p>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton text={publicUrl} label="Copy public link" copiedLabel="Link copied" />
                    <a href={`/r/${r.slug}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                      <ExternalLink className="size-4" aria-hidden /> View<span className="sr-only"> public page (opens in a new tab)</span>
                    </a>
                    {canShare ? (
                      <Link href={`/admin/resources/share?resource=${r.id}`} className={buttonVariants({ size: "sm" })}>
                        <Send className="size-4" aria-hidden /> Share
                      </Link>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted">Anyone with this link can see the page. It is hidden from search engines.</p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  {r.visibility !== "shareable"
                    ? "Internal only: there is no public page and it cannot be shared."
                    : "Switched off or expired: the public page shows “not available” and it cannot be shared."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader icon={<IconTile icon={History} color="violet" size="sm" />} actions={shares.total > shares.rows.length ? <Link href={`/admin/resources/history?resource=${r.id}`} className="text-sm text-brand-700 hover:underline">All</Link> : undefined}>
              <CardTitle>Share history</CardTitle>
              <CardDescription>
                {shareCount ? `Shared ${shareCount} time${shareCount === 1 ? "" : "s"}` : "Not shared yet"}
                {!access.permissions.includes("candidates.view_all") ? " (only candidates you can see are listed)" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ShareHistoryList rows={shares.rows} members={members} timeZone={tz} showResources={false} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
