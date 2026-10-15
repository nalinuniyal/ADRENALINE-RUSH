import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpen, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { hasAny } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { searchTerm } from "@/lib/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { IconTile } from "@/components/ui/icon-tile";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage({ searchParams }: PageProps<"/admin/search">) {
  return (
    <>
      <PageHeader title="Search" icon={Search} color="navy" description="Find candidates and courses by name, email or phone." />
      <Suspense fallback={<div className="ar-skeleton h-40 rounded-[var(--radius-card)]" />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/admin/search">["searchParams"] }) {
  const { access } = await requireAccess();
  const q = searchTerm((await searchParams).q);
  const canCandidates = hasAny(access.permissions, ["candidates.view_all", "candidates.view_assigned"]);
  const canCourses = hasAny(access.permissions, ["courses.view"]);

  const form = (
    <form action="/admin/search" role="search" className="mb-4 flex gap-2">
      <label htmlFor="search-q" className="sr-only">
        Search
      </label>
      <Input id="search-q" name="q" type="search" defaultValue={q} placeholder="Name, email, phone or course" autoFocus />
      <Button type="submit">Search</Button>
    </form>
  );

  if (q.length < 2) {
    return (
      <>
        {form}
        <EmptyState icon={<Search className="size-6" aria-hidden />} title="Type at least two characters" />
      </>
    );
  }

  const supabase = await createSupabaseServerClient();
  const like = `%${q}%`;
  const [candidates, courses] = await Promise.all([
    canCandidates
      ? supabase
          .from("candidates")
          .select("id, full_name, email, phone")
          .eq("organization_id", access.organization.id)
          .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like},company.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(20)
      : null,
    canCourses
      ? supabase
          .from("courses")
          .select("id, title, slug, status")
          .eq("organization_id", access.organization.id)
          .ilike("title", like)
          .order("updated_at", { ascending: false })
          .limit(20)
      : null,
  ]);
  if (candidates?.error || courses?.error) throw new Error("Search failed. Please try again.");

  const candidateRows = candidates?.data ?? [];
  const courseRows = courses?.data ?? [];

  return (
    <>
      {form}
      {candidateRows.length === 0 && courseRows.length === 0 ? (
        <EmptyState icon={<Search className="size-6" aria-hidden />} title={`No results for “${q}”`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {canCandidates ? (
            <Card>
              <CardHeader icon={<IconTile icon={Users} color="teal" size="sm" />}>
                <CardTitle>Candidates ({candidateRows.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-line">
                  {candidateRows.map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/candidates/${c.id}`} className="block px-5 py-3 transition hover:bg-brand-50">
                        <p className="font-medium text-brand-700">{c.full_name || "Unnamed"}</p>
                        <p className="text-xs text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
                      </Link>
                    </li>
                  ))}
                  {candidateRows.length === 0 ? <li className="px-5 py-3 text-sm text-muted">No candidates match.</li> : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {canCourses ? (
            <Card>
              <CardHeader icon={<IconTile icon={BookOpen} color="blue" size="sm" />}>
                <CardTitle>Courses ({courseRows.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-line">
                  {courseRows.map((c) => (
                    <li key={c.id}>
                      <Link href={`/admin/courses/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-brand-50">
                        <span className="font-medium text-brand-700">{c.title}</span>
                        <Badge tone={c.status === "published" ? "success" : c.status === "archived" ? "neutral" : "warning"}>{c.status}</Badge>
                      </Link>
                    </li>
                  ))}
                  {courseRows.length === 0 ? <li className="px-5 py-3 text-sm text-muted">No courses match.</li> : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
