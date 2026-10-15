import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink, FileText, Pencil, PlayCircle, Plus, Search, Send } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { requireAccess } from "@/lib/auth/session";
import { siteUrl } from "@/lib/email/automations";
import { formatDate } from "@/lib/format";
import { autoThumbnail, linkHost } from "@/lib/resources/embed";
import { resourceLink } from "@/lib/resources/message";
import { isShareable, RESOURCE_TYPES, RESOURCE_TYPE_LABELS, resourceTypeLabel, todayIn } from "@/lib/resources/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { firstParam } from "@/lib/validation/courses";
import { resourceListFilterSchema } from "@/lib/validation/resources";
import { CopyButton } from "./_components/copy-button";
import { VisibilityBadges } from "./_components/resource-badges";
import { ResourcesHeader, ResourcesSkeleton } from "./_components/resources-header";

export const metadata: Metadata = { title: "Demos & Resources" };

const MAX_ROWS = 300;

export default function ResourcesPage({ searchParams }: PageProps<"/admin/resources">) {
  return (
    <Suspense fallback={<ResourcesSkeleton label="Loading resources" />}>
      <ResourceLibrary searchParams={searchParams} />
    </Suspense>
  );
}

function escapeLike(v: string) {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function ResourceLibrary({ searchParams }: { searchParams: PageProps<"/admin/resources">["searchParams"] }) {
  const { access, denied } = await requireAccess(["resources.view"]);
  if (denied) return <AccessDenied />;
  const canManage = access.permissions.includes("resources.manage");
  const canShare = access.permissions.includes("resources.share");
  const orgId = access.organization.id;

  const raw = await searchParams;
  const filters = resourceListFilterSchema.parse({ q: firstParam(raw.q), type: firstParam(raw.type), course: firstParam(raw.course), status: firstParam(raw.status) });
  const supabase = await createSupabaseServerClient();

  let courseResourceIds: string[] | null = null;
  if (filters.course) {
    const { data } = await supabase.from("resource_courses").select("resource_id").eq("course_id", filters.course);
    courseResourceIds = (data ?? []).map((r) => r.resource_id);
  }

  let query = supabase
    .from("resources")
    .select("id, title, slug, type, url, thumbnail_url, description, visibility, is_active, expires_on, updated_at, resource_courses(course_id)")
    .eq("organization_id", orgId);
  if (filters.q) query = query.ilike("title", `%${escapeLike(filters.q)}%`);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.status === "active") query = query.eq("is_active", true);
  if (filters.status === "inactive") query = query.eq("is_active", false);
  if (filters.status === "shareable") query = query.eq("visibility", "shareable");
  if (filters.status === "internal") query = query.eq("visibility", "internal");
  if (courseResourceIds) query = query.in("id", courseResourceIds.length ? courseResourceIds : ["00000000-0000-0000-0000-000000000000"]);

  const [resourcesRes, coursesRes, countsRes] = await Promise.all([
    query.order("updated_at", { ascending: false }).limit(MAX_ROWS + 1),
    access.permissions.includes("courses.view") || canManage
      ? supabase.from("courses").select("id, title").eq("organization_id", orgId).neq("status", "archived").order("title")
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
    supabase.rpc("resource_share_counts", { p_org: orgId }),
  ]);
  if (resourcesRes.error) {
    console.error(JSON.stringify({ level: "error", msg: "resource list failed", code: resourcesRes.error.code }));
    throw new Error("Could not load resources. If you just updated the app, run the latest supabase/setup.sql.");
  }

  const all = resourcesRes.data ?? [];
  const truncated = all.length > MAX_ROWS;
  const resources = all.slice(0, MAX_ROWS);
  const courses = coursesRes.data ?? [];
  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));
  const counts = new Map((countsRes.data ?? []).map((c) => [c.resource_id, Number(c.shares)]));
  const filtered = Boolean(filters.q || filters.type || filters.course || filters.status !== "all");
  const site = siteUrl();
  const today = todayIn(access.organization.timezone);

  return (
    <>
      <ResourcesHeader
        active="library"
        description="Demo videos, recordings, curriculum documents and links. Share them with candidates by WhatsApp, email or a copied message."
        actions={
          <>
            {canShare ? (
              <Link href="/admin/resources/share" className={buttonVariants({ variant: "secondary" })}>
                <Send className="size-4" aria-hidden /> Share
              </Link>
            ) : null}
            {canManage ? (
              <Link href="/admin/resources/new" className={buttonVariants()}>
                <Plus className="size-4" aria-hidden /> New resource
              </Link>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <Form
          key={`${filters.q}|${filters.type}|${filters.course}|${filters.status}`}
          action="/admin/resources"
          role="search"
          aria-label="Filter resources"
          className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] lg:items-end"
        >
          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
            <label htmlFor="res-q" className="text-xs font-medium text-[#444]">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input id="res-q" name="q" type="search" defaultValue={filters.q} placeholder="Search by title" className="pl-9" maxLength={100} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="res-type" className="text-xs font-medium text-[#444]">
              Type
            </label>
            <Select id="res-type" name="type" defaultValue={filters.type}>
              <option value="">All types</option>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RESOURCE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="res-course" className="text-xs font-medium text-[#444]">
              Course
            </label>
            <Select id="res-course" name="course" defaultValue={filters.course}>
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="res-status" className="text-xs font-medium text-[#444]">
              Show
            </label>
            <Select id="res-status" name="status" defaultValue={filters.status}>
              <option value="all">Everything</option>
              <option value="active">Switched on</option>
              <option value="inactive">Switched off</option>
              <option value="shareable">Shareable</option>
              <option value="internal">Internal only</option>
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonVariants({ className: "flex-1 sm:flex-none" })}>
              Apply
            </button>
            {filtered ? (
              <Link href="/admin/resources" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            ) : null}
          </div>
        </Form>
      </Card>

      {resources.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search className="size-6" aria-hidden />}
            title="No resources match these filters"
            description="Try a different search or clear the filters."
            action={
              <Link href="/admin/resources" className={buttonVariants({ variant: "secondary" })}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<PlayCircle className="size-6" aria-hidden />}
            title="No demos or resources yet"
            description={
              canManage
                ? "Add a demo video, class recording, curriculum PDF or any https link (YouTube, Google Drive, Vimeo…). Then share it with candidates in two clicks."
                : "Resources will appear here once someone who manages resources adds them."
            }
            action={
              canManage ? (
                <Link href="/admin/resources/new" className={buttonVariants()}>
                  <Plus className="size-4" aria-hidden /> New resource
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <p className="sr-only" aria-live="polite">
            {resources.length} resource{resources.length === 1 ? "" : "s"} found
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {resources.map((r) => {
              const thumb = r.thumbnail_url ?? autoThumbnail(r.url);
              const shareable = isShareable(r, today);
              const shares = counts.get(r.id) ?? 0;
              const linked = ((r.resource_courses as unknown as { course_id: string }[] | null) ?? []).map((c) => courseTitle.get(c.course_id)).filter(Boolean) as string[];
              const publicUrl = resourceLink({ id: r.id, title: r.title, slug: r.slug, url: r.url }, site);
              return (
                <li key={r.id} className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
                  <div className="relative aspect-video bg-gradient-to-br from-ink-900 to-brand-700">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-white/80">
                        <FileText className="size-10" aria-hidden />
                      </span>
                    )}
                    <span className="absolute top-2 left-2">
                      <Badge tone="inverse">{resourceTypeLabel(r.type)}</Badge>
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex flex-wrap gap-1.5">
                      <VisibilityBadges visibility={r.visibility} isActive={r.is_active} expiresOn={r.expires_on} today={today} />
                      <Badge tone={shares ? "violet" : "neutral"}>
                        {shares ? (
                          <Link href={`/admin/resources/history?resource=${r.id}`} className="hover:underline">
                            Shared {shares}×
                          </Link>
                        ) : (
                          "Not shared yet"
                        )}
                      </Badge>
                    </div>
                    <h2 className="font-semibold break-words">
                      {canManage ? (
                        <Link href={`/admin/resources/${r.id}`} className="text-brand-700 hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        r.title
                      )}
                    </h2>
                    {r.description ? <p className="line-clamp-2 text-sm text-muted">{r.description}</p> : null}
                    <p className="text-xs text-muted">
                      {linked.length ? linked.join(", ") : "No course"} · {linkHost(r.url)} · Updated {formatDate(r.updated_at, access.organization.timezone)}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      {canShare && shareable ? (
                        <Link href={`/admin/resources/share?resource=${r.id}`} className={buttonVariants({ size: "sm" })}>
                          <Send className="size-4" aria-hidden /> Share
                        </Link>
                      ) : null}
                      {shareable ? <CopyButton text={publicUrl} label="Copy public link" copiedLabel="Link copied" /> : null}
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                        <ExternalLink className="size-4" aria-hidden /> Open<span className="sr-only"> {r.title} (opens in a new tab)</span>
                      </a>
                      {canManage ? (
                        <Link href={`/admin/resources/${r.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                          <Pencil className="size-4" aria-hidden /> Edit<span className="sr-only"> {r.title}</span>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {truncated ? <p className="mt-4 text-center text-sm text-muted">Showing the {MAX_ROWS} most recently updated resources. Use the filters to find older ones.</p> : null}
        </>
      )}
    </>
  );
}
