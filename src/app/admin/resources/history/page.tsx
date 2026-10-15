import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { getMemberNames } from "@/lib/data/candidates";
import { SHARE_METHOD_LABELS, SHARE_METHODS } from "@/lib/resources/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResourcesHeader, ResourcesSkeleton } from "../_components/resources-header";
import { loadShares, ShareHistoryList } from "../_components/share-history";

export const metadata: Metadata = { title: "Share history" };

const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function ShareHistoryPage({ searchParams }: PageProps<"/admin/resources/history">) {
  return (
    <Suspense fallback={<ResourcesSkeleton label="Loading share history" />}>
      <ShareHistory searchParams={searchParams} />
    </Suspense>
  );
}

async function ShareHistory({ searchParams }: { searchParams: PageProps<"/admin/resources/history">["searchParams"] }) {
  const { access, denied } = await requireAccess(["resources.view"]);
  if (denied) return <AccessDenied />;
  const orgId = access.organization.id;
  const raw = await searchParams;
  const resourceId = UUID_RE.test(one(raw.resource)) ? one(raw.resource) : "";
  const candidateId = UUID_RE.test(one(raw.candidate)) ? one(raw.candidate) : "";
  const method = (SHARE_METHODS as readonly string[]).includes(one(raw.method)) ? one(raw.method) : "";
  const page = Math.min(Math.max(Number.parseInt(one(raw.page), 10) || 1, 1), 1000);

  const supabase = await createSupabaseServerClient();
  const [shares, members, resourceRes, candidateRes] = await Promise.all([
    loadShares(supabase, orgId, { resourceId: resourceId || undefined, candidateId: candidateId || undefined, method: method || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getMemberNames(supabase, orgId),
    resourceId ? supabase.from("resources").select("title").eq("id", resourceId).maybeSingle() : Promise.resolve({ data: null }),
    candidateId ? supabase.from("candidates").select("full_name").eq("id", candidateId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pages = Math.max(1, Math.ceil(shares.total / PAGE_SIZE));
  const href = (patch: Record<string, string | number>) => {
    const qs = new URLSearchParams();
    const next = { resource: resourceId, candidate: candidateId, method, page, ...patch };
    for (const [k, v] of Object.entries(next)) if (v && !(k === "page" && v === 1)) qs.set(k, String(v));
    const s = qs.toString();
    return s ? `/admin/resources/history?${s}` : "/admin/resources/history";
  };
  const filterLabel = [resourceRes.data?.title ? `Resource: ${resourceRes.data.title}` : "", candidateRes.data?.full_name ? `Candidate: ${candidateRes.data.full_name}` : ""].filter(Boolean).join(" · ");

  return (
    <>
      <ResourcesHeader active="history" description="Every share: who received what, how and when. Copied messages and opened WhatsApp chats are not confirmed as sent." />
      {!access.permissions.includes("candidates.view_all") ? (
        <Alert tone="info" className="mb-4">
          Only shares with candidates you can see are listed.
        </Alert>
      ) : null}
      <Card>
        <CardHeader icon={<IconTile icon={History} color="violet" size="sm" />}>
          <CardTitle>Share history</CardTitle>
          <CardDescription>
            {shares.total} share{shares.total === 1 ? "" : "s"}
            {filterLabel ? ` · ${filterLabel}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <nav aria-label="Filter by method" className="mb-3 flex flex-wrap gap-1.5">
            <Link href={href({ method: "", page: 1 })} aria-current={method === "" ? "page" : undefined} className={buttonVariants({ variant: method === "" ? "primary" : "secondary", size: "xs" })}>
              All methods
            </Link>
            {SHARE_METHODS.map((m) => (
              <Link key={m} href={href({ method: m, page: 1 })} aria-current={method === m ? "page" : undefined} className={buttonVariants({ variant: method === m ? "primary" : "secondary", size: "xs" })}>
                {SHARE_METHOD_LABELS[m]}
              </Link>
            ))}
            {resourceId || candidateId ? (
              <Link href="/admin/resources/history" className={buttonVariants({ variant: "ghost", size: "xs" })}>
                Clear filters
              </Link>
            ) : null}
          </nav>
          <ShareHistoryList rows={shares.rows} members={members} timeZone={access.organization.timezone} empty="No shares match." />
          {pages > 1 ? (
            <nav aria-label="Pagination" className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
              <span className="text-muted">
                Page {page} of {pages}
              </span>
              <span className="flex gap-2">
                {page > 1 ? (
                  <Link href={href({ page: page - 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="prev">
                    <ChevronLeft className="size-4" aria-hidden /> Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={href({ page: page + 1 })} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="next">
                    Next <ChevronRight className="size-4" aria-hidden />
                  </Link>
                ) : null}
              </span>
            </nav>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
