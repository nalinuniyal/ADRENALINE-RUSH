import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Award, BookOpenCheck, CalendarClock, CalendarCheck2, CheckCircle2, Clock, GraduationCap, MonitorSmartphone, PlayCircle, Signal, UserRound } from "lucide-react";
import { Aurora } from "@/components/fx/aurora";
import { Reveal } from "@/components/fx/reveal";
import { PriceTag } from "@/components/public/course-card";
import { CourseInclusions } from "@/components/public/course-inclusions";
import { RegistrationForm } from "@/components/public/registration-form";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getPublicCourse, getPublicForm } from "@/lib/data/public-courses";
import { courseCtaLabel } from "@/lib/public-site";
import { deliveryLabel, formatDate } from "@/lib/format";

export async function generateMetadata({ params }: PageProps<"/courses/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const course = await getPublicCourse(slug).catch(() => null);
  if (!course) return { title: "Course not found", robots: { index: false } };
  const description = course.short_description ?? `Register for ${course.title} at Adrenaline Rush.`;
  return {
    title: course.title,
    description,
    alternates: { canonical: `/courses/${course.slug}` },
    openGraph: { title: course.title, description, type: "website", images: course.cover_image_url ? [course.cover_image_url] : undefined },
    twitter: { card: "summary_large_image", title: course.title, description },
  };
}

export default function CoursePage({ params }: PageProps<"/courses/[slug]">) {
  return (
    <Suspense fallback={<div className="h-[70vh] bg-ink-900" />}>
      <CourseDetail params={params} />
    </Suspense>
  );
}

async function CourseDetail({ params }: { params: PageProps<"/courses/[slug]">["params"] }) {
  const { slug } = await params;
  const [course, form] = await Promise.all([getPublicCourse(slug), getPublicForm(slug)]);
  if (!course) notFound();

  const facts = [
    { icon: Clock, label: "Duration", value: course.duration_text },
    { icon: MonitorSmartphone, label: "Delivery", value: deliveryLabel(course.delivery_mode) },
    { icon: Signal, label: "Level", value: course.level },
    { icon: UserRound, label: "Trainer", value: course.instructor_name },
  ].filter((f) => f.value);
  const isDemo = course.registration_mode === "demo";
  const ctaLabel = courseCtaLabel(course);

  return (
    <>
      <section className="relative isolate overflow-hidden bg-gradient-to-b from-ink-950 to-ink-900 text-white">
        <Aurora className="opacity-80" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pt-28 pb-16 sm:px-6 sm:pt-32 lg:grid-cols-[1.4fr_1fr]">
          <div>
            {course.highlight_badge ? (
              <p className="ar-glass mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-volt-400">
                <span className="size-1.5 animate-pulse-ring rounded-full bg-volt-400" aria-hidden /> {course.highlight_badge}
              </p>
            ) : null}
            {course.category ? <p className="animate-fade-up text-sm font-semibold tracking-wider text-volt-400 uppercase">{course.category.name}</p> : null}
            <h1 className="mt-2 animate-fade-up font-display text-3xl font-bold tracking-tight text-balance [animation-delay:60ms] sm:text-5xl">{course.title}</h1>
            {course.short_description ? <p className="mt-4 max-w-2xl animate-fade-up text-lg text-white/75 [animation-delay:120ms]">{course.short_description}</p> : null}
            <div className="mt-8 flex animate-fade-up flex-wrap gap-3 [animation-delay:180ms]">
              {course.registration_open ? (
                <a href="#register" className={buttonVariants({ variant: "glow", size: "lg" })}>{ctaLabel}</a>
              ) : null}
              {course.demo_url ? (
                <a href={course.demo_url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outlineInverse", size: "lg" })}>
                  <PlayCircle className="size-4" aria-hidden /> Watch demo
                </a>
              ) : course.registration_open && !isDemo ? (
                <a href="#register" className={buttonVariants({ variant: "outlineInverse", size: "lg" })}>Request a demo</a>
              ) : null}
            </div>
          </div>
          <div className="ar-glass animate-scale-in self-start rounded-2xl p-6 [animation-delay:200ms]">
            <p className="text-sm text-white/60">Course fee</p>
            <PriceTag course={course} className="mt-1 block text-3xl" />
            <dl className="mt-6 grid grid-cols-2 gap-4">
              {facts.map(({ icon: Icon, label, value }) => (
                <div key={label}>
                  <dt className="flex items-center gap-1.5 text-xs text-white/55"><Icon className="size-3.5" aria-hidden /> {label}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {course.enrollment_closes_on && course.registration_open ? (
              <p className="mt-5 flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs">
                <CalendarClock className="size-4 text-volt-400" aria-hidden /> Registration closes {formatDate(course.enrollment_closes_on)}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-12">
          {course.description ? (
            <Reveal as="section">
              <h2 className="font-display text-2xl font-bold text-ink-900">Overview</h2>
              <div className="mt-4 space-y-4 text-[15px] leading-7 whitespace-pre-line text-[#333]">{course.description}</div>
            </Reveal>
          ) : null}

          <CourseInclusions items={course.inclusions} />

          {course.who_is_it_for ? (
            <Reveal as="section">
              <h2 className="font-display text-2xl font-bold text-ink-900">Who this course is for</h2>
              <p className="mt-4 text-[15px] leading-7 whitespace-pre-line text-[#333]">{course.who_is_it_for}</p>
            </Reveal>
          ) : null}

          {course.learning_outcomes.length ? (
            <Reveal as="section">
              <h2 className="font-display text-2xl font-bold text-ink-900">What you will learn</h2>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {course.learning_outcomes.map((o) => (
                  <li key={o} className="flex gap-3 rounded-lg border border-line bg-surface p-3 text-sm shadow-card">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-700" aria-hidden /> {o}
                  </li>
                ))}
              </ul>
            </Reveal>
          ) : null}

          {course.modules.length ? (
            <Reveal as="section">
              <h2 className="font-display text-2xl font-bold text-ink-900">Curriculum</h2>
              <ol className="mt-5 space-y-3">
                {course.modules.map((m, i) => (
                  <li key={`${m.title}-${i}`}>
                    <details className="group rounded-lg border border-line bg-surface shadow-card open:shadow-raised" open={i === 0}>
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
                        <span className="flex-1 font-semibold">{m.title}</span>
                        <span className="text-xs text-muted">{m.lessons.length} {m.lessons.length === 1 ? "lesson" : "lessons"}</span>
                        <span aria-hidden className="text-muted transition group-open:rotate-90">›</span>
                      </summary>
                      {m.lessons.length ? (
                        <ul className="border-t border-line px-4 py-2">
                          {m.lessons.map((l, j) => (
                            <li key={`${l.title}-${j}`} className="flex items-center gap-2 py-1.5 text-sm text-[#444]">
                              <BookOpenCheck className="size-3.5 text-brand-600" aria-hidden /> {l.title}
                              {l.duration_minutes ? <span className="ml-auto text-xs text-muted">{l.duration_minutes} min</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </details>
                  </li>
                ))}
              </ol>
            </Reveal>
          ) : null}

          {course.prerequisites ? (
            <Reveal as="section">
              <h2 className="font-display text-2xl font-bold text-ink-900">Prerequisites</h2>
              <p className="mt-4 text-[15px] leading-7 whitespace-pre-line text-[#333]">{course.prerequisites}</p>
            </Reveal>
          ) : null}

          {course.certificate_details ? (
            <Reveal as="section" className="flex gap-4 rounded-xl border border-line bg-gradient-to-br from-brand-50 to-surface p-5">
              <Award className="size-8 shrink-0 text-brand-600" aria-hidden />
              <div>
                <h2 className="font-semibold text-ink-900">Certificate</h2>
                <p className="mt-1 text-sm text-[#444]">{course.certificate_details}</p>
              </div>
            </Reveal>
          ) : null}

          {course.faqs.length ? (
            <Reveal as="section">
              <h2 className="font-display text-2xl font-bold text-ink-900">FAQs</h2>
              <div className="mt-5 divide-y divide-line rounded-lg border border-line bg-surface">
                {course.faqs.map((f, i) => (
                  <details key={i} className="group px-4 py-3">
                    <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">{f.q}</summary>
                    <p className="mt-2 text-sm text-[#444]">{f.a}</p>
                  </details>
                ))}
              </div>
            </Reveal>
          ) : null}
        </div>

        <aside id="register" className="scroll-mt-24 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-raised">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-violet-500 text-white shadow-glow">
                {isDemo ? <CalendarCheck2 className="size-5" aria-hidden /> : <GraduationCap className="size-5" aria-hidden />}
              </span>
              <div>
                <h2 className="font-display text-lg font-bold text-ink-900">{isDemo ? "Book your free demo" : "Register your interest"}</h2>
                <p className="text-xs text-muted">{isDemo ? "Free live demo class. No payment, no obligation." : "Takes about two minutes. No payment now."}</p>
              </div>
            </div>
            <div className="mt-6">
              {course.registration_open && form ? (
                <RegistrationForm slug={course.slug} fields={form.fields} channel={isDemo ? "demo_request" : "public_form"} submitLabel={ctaLabel} />
              ) : (
                <Alert tone="warning" title="Registration is closed">
                  This program isn&apos;t accepting registrations right now. Check back soon or contact us for the next batch.
                </Alert>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
