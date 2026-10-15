import Link from "next/link";
import { ArrowUpRight, Clock, MonitorSmartphone, Signal } from "lucide-react";
import { Spotlight } from "@/components/fx/spotlight";
import { Badge } from "@/components/ui/badge";
import { deliveryLabel, formatMoney } from "@/lib/format";
import type { PublicCourseSummary } from "@/lib/data/public-courses";

export function PriceTag({ course, className }: { course: Pick<PublicCourseSummary, "show_price" | "list_price" | "discounted_price" | "currency">; className?: string }) {
  if (!course.show_price || course.list_price === null) return <span className={className}>Contact for fees</span>;
  const hasDiscount = course.discounted_price !== null && course.discounted_price < course.list_price;
  return (
    <span className={className}>
      <span className="font-bold">{formatMoney(hasDiscount ? course.discounted_price : course.list_price, course.currency)}</span>
      {hasDiscount ? <span className="ml-2 text-sm line-through opacity-60">{formatMoney(course.list_price, course.currency)}</span> : null}
    </span>
  );
}

export function CourseCard({ course }: { course: PublicCourseSummary }) {
  return (
    <Spotlight className="ar-lift group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-ink-900 via-brand-700 to-violet-500">
        {course.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.cover_image_url} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          <div aria-hidden className="ar-grid-bg absolute inset-0 opacity-60" />
        )}
        <div className="absolute top-3 left-3 flex gap-2">
          {course.category ? <Badge tone="inverse">{course.category.name}</Badge> : null}
          {!course.registration_open ? <Badge tone="warning">Registration closed</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg font-bold text-ink-900">
          <Link href={`/courses/${course.slug}`} className="after:absolute after:inset-0">
            {course.title}
          </Link>
        </h3>
        {course.short_description ? <p className="mt-2 line-clamp-3 text-sm text-muted">{course.short_description}</p> : null}
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {course.duration_text ? (
            <li className="flex items-center gap-1"><Clock className="size-3.5" aria-hidden /> {course.duration_text}</li>
          ) : null}
          <li className="flex items-center gap-1"><MonitorSmartphone className="size-3.5" aria-hidden /> {deliveryLabel(course.delivery_mode)}</li>
          {course.level ? (
            <li className="flex items-center gap-1"><Signal className="size-3.5" aria-hidden /> {course.level}</li>
          ) : null}
        </ul>
        <div className="mt-auto flex items-center justify-between pt-5">
          <PriceTag course={course} className="text-ink-900" />
          <ArrowUpRight className="size-5 text-brand-600 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
        </div>
      </div>
    </Spotlight>
  );
}
