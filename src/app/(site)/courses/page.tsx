import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import { CourseCard } from "@/components/public/course-card";
import { PageHero } from "@/components/public/page-hero";
import { Reveal } from "@/components/fx/reveal";
import { EmptyState } from "@/components/ui/empty-state";
import { getPublicCourses } from "@/lib/data/public-courses";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Courses",
  description: "Live, career-focused technology training programs.",
  alternates: { canonical: "/courses" },
};

export default function CoursesPage({ searchParams }: PageProps<"/courses">) {
  return (
    <>
      <PageHero eyebrow="Programs" title="Find your next course">
        Live cohorts and workshops built around real projects. Pick a program to see the curriculum, upcoming batches and how to register.
      </PageHero>
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Suspense fallback={<CourseGridSkeleton />}>
          <CourseGrid searchParams={searchParams} />
        </Suspense>
      </section>
    </>
  );
}

async function CourseGrid({ searchParams }: { searchParams: PageProps<"/courses">["searchParams"] }) {
  const params = await searchParams;
  const category = typeof params.category === "string" ? params.category : undefined;
  const courses = await getPublicCourses();
  const categories = [...new Map(courses.filter((c) => c.category).map((c) => [c.category!.slug, c.category!])).values()];
  const shown = category ? courses.filter((c) => c.category?.slug === category) : courses;

  if (courses.length === 0) {
    return <EmptyState icon={<BookOpen className="size-6" aria-hidden />} title="New programs are on the way" description="Courses will appear here as soon as they are published." />;
  }

  return (
    <>
      {categories.length > 1 ? (
        <nav aria-label="Categories" className="mb-8 flex flex-wrap gap-2">
          {[{ slug: undefined, name: "All" }, ...categories].map((c) => {
            const active = c.slug === category;
            return (
              <Link
                key={c.slug ?? "all"}
                href={c.slug ? `/courses?category=${c.slug}` : "/courses"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm transition",
                  active ? "border-brand-600 bg-brand-600 text-white shadow-glow" : "border-line-strong bg-surface hover:border-brand-400 hover:text-brand-600",
                )}
              >
                {c.name}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c, i) => (
          <Reveal key={c.slug} delay={(i % 3) * 80}>
            <CourseCard course={c} />
          </Reveal>
        ))}
      </div>
    </>
  );
}

function CourseGridSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="ar-skeleton h-80 rounded-xl" />
      ))}
    </div>
  );
}
