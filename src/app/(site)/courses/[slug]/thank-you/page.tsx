import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CheckCircle2 } from "lucide-react";
import { Aurora } from "@/components/fx/aurora";
import { buttonVariants } from "@/components/ui/button";
import { getPublicCourse } from "@/lib/data/public-courses";
import { getPublicSite } from "@/lib/data/public-site";

export const metadata: Metadata = { title: "Registration received", robots: { index: false } };

export default function ThankYouPage({ params }: PageProps<"/courses/[slug]/thank-you">) {
  return (
    <section className="relative isolate flex min-h-[80vh] items-center overflow-hidden bg-gradient-to-b from-ink-950 to-ink-900 text-white">
      <Aurora />
      <div className="relative mx-auto max-w-xl px-4 py-32 text-center">
        <div className="mx-auto flex size-20 animate-scale-in items-center justify-center rounded-full bg-success-500/15 ring-8 ring-success-500/10">
          <CheckCircle2 className="size-10 text-success-500" aria-hidden />
        </div>
        <Suspense fallback={<h1 className="mt-8 font-display text-3xl font-bold">Thank you!</h1>}>
          <Message params={params} />
        </Suspense>
      </div>
    </section>
  );
}

async function Message({ params }: { params: PageProps<"/courses/[slug]/thank-you">["params"] }) {
  const { slug } = await params;
  const [course, site] = await Promise.all([getPublicCourse(slug).catch(() => null), getPublicSite()]);
  const isDemo = course?.registration_mode === "demo";
  return (
    <>
      <h1 className="mt-8 animate-fade-up font-display text-3xl font-bold sm:text-4xl">
        {isDemo ? "Thank you, your free demo request is in!" : "Thank you, you’re registered!"}
      </h1>
      <p className="mt-4 animate-fade-up text-white/75 [animation-delay:80ms]">
        {course?.success_message ??
          (isDemo
            ? `We've received your request for a free demo of ${course.title}. Our team will contact you shortly with the demo date, time and joining link.`
            : `We've received your details${course ? ` for ${course.title}` : ""}. Our team will contact you shortly with next steps.`)}
      </p>
      <div className="mt-8 flex animate-fade-up justify-center gap-3 [animation-delay:160ms]">
        {course ? (
          <Link href={`/courses/${course.slug}`} className={buttonVariants({ variant: "outlineInverse" })}>Back to course</Link>
        ) : null}
        {site.show_course_catalog ? (
          <Link href="/courses" className={buttonVariants({ variant: "inverse" })}>Browse more courses</Link>
        ) : null}
      </div>
    </>
  );
}
