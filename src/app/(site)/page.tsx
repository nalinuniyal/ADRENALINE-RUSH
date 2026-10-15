import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  BrainCircuit,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Cloud,
  Code2,
  LineChart,
  Mail,
  MapPin,
  MessageCircle,
  MonitorSmartphone,
  Phone,
  PlayCircle,
  Rocket,
  Sparkles,
  Users,
} from "lucide-react";
import { Aurora } from "@/components/fx/aurora";
import { Reveal } from "@/components/fx/reveal";
import { Spotlight } from "@/components/fx/spotlight";
import { Tilt } from "@/components/fx/tilt";
import { buttonVariants } from "@/components/ui/button";
import { courseCtaLabel, getPublicSite, telLink, whatsappLink, type PublicFeaturedCourse } from "@/lib/data/public-site";
import { deliveryLabel } from "@/lib/format";

const TRACKS = [
  { icon: Cloud, label: "Salesforce & CRM" },
  { icon: Sparkles, label: "Marketing Cloud" },
  { icon: BrainCircuit, label: "AI & Automation" },
  { icon: LineChart, label: "Data & Analytics" },
  { icon: Code2, label: "Software Development" },
  { icon: Rocket, label: "Career Mentoring" },
];

const STEPS = [
  { icon: PlayCircle, title: "Watch a demo", body: "Sample a real session and the curriculum before you commit." },
  { icon: Users, title: "Join a batch", body: "Small cohorts with a fixed schedule and a dedicated trainer." },
  { icon: CalendarClock, title: "Attend live", body: "Interactive online classes with recordings for revision." },
  { icon: ClipboardCheck, title: "Build & practise", body: "Assignments and projects that mirror real work." },
];

export default function HomePage() {
  return (
    <>
        <section className="relative isolate overflow-hidden bg-gradient-to-b from-ink-950 via-ink-900 to-ink-950 text-white">
          <Aurora />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-32 pb-24 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:pt-40 lg:pb-32">
            <Suspense fallback={<HeroCopy />}>
              <SiteHeroCopy />
            </Suspense>

            <Suspense fallback={<LearningPathCard />}>
              <HeroAside />
            </Suspense>
          </div>

          <div className="relative border-y border-white/10 bg-white/[0.03] py-4">
            <ul className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-8 gap-y-3 px-4 text-sm text-white/70">
              {TRACKS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="size-4 text-volt-400" aria-hidden /> {label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how-it-works" className="relative bg-canvas">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <Reveal>
              <p className="text-sm font-semibold tracking-wider text-brand-600 uppercase">How it works</p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">From first demo to first offer</h2>
            </Reveal>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 90}>
                  <Spotlight className="ar-lift h-full rounded-xl border border-line bg-surface p-6 shadow-card">
                    <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-glow">
                      <Icon className="size-5" aria-hidden />
                    </div>
                    <p className="mt-5 text-xs font-semibold text-brand-600">STEP {i + 1}</p>
                    <h3 className="mt-1 text-base font-bold">{title}</h3>
                    <p className="mt-2 text-sm text-muted">{body}</p>
                  </Spotlight>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="relative scroll-mt-20 overflow-hidden bg-ink-900 text-white">
          <Aurora className="opacity-60" />
          <Reveal className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Ready to start?</h2>
            <Suspense fallback={<div className="mx-auto mt-4 h-24 max-w-2xl" aria-hidden />}>
              <ContactDetails />
            </Suspense>
          </Reveal>
        </section>
    </>
  );
}

const DEFAULT_BADGE = "Admissions open for upcoming batches";
const DEFAULT_SUBTITLE = "Live cohorts, hands-on projects and honest guidance across CRM, marketing technology, data, AI and software careers.";

/** Hero text and buttons from Settings › Website, with the built-in copy as fallback. */
async function SiteHeroCopy() {
  const site = await getPublicSite();
  return (
    <HeroCopy
      badge={site.hero_badge}
      title={site.hero_title}
      subtitle={site.hero_subtitle}
      featured={site.featured_course}
      showCatalog={site.show_course_catalog}
    />
  );
}

function HeroCopy({
  badge,
  title,
  subtitle,
  featured = null,
  showCatalog = true,
}: {
  badge?: string | null;
  title?: string | null;
  subtitle?: string | null;
  featured?: PublicFeaturedCourse | null;
  showCatalog?: boolean;
}) {
  return (
    <div>
      <p className="ar-glass inline-flex animate-fade-up items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-volt-400">
        <span className="size-1.5 animate-pulse-ring rounded-full bg-volt-400" /> {badge ?? DEFAULT_BADGE}
      </p>
      <h1 className="mt-6 animate-fade-up font-display text-4xl leading-[1.05] font-bold tracking-tight text-balance [animation-delay:80ms] sm:text-6xl">
        {title ?? (
          <>
            Train for the roles <span className="ar-text-gradient">the future is hiring for.</span>
          </>
        )}
      </h1>
      <p className="mt-6 max-w-xl animate-fade-up text-lg whitespace-pre-line text-white/70 [animation-delay:160ms]">{subtitle ?? DEFAULT_SUBTITLE}</p>
      <div className="mt-10 flex animate-fade-up flex-col gap-3 [animation-delay:240ms] sm:flex-row">
        {featured ? (
          <Link href={`/courses/${featured.slug}#register`} className={buttonVariants({ variant: "glow", size: "lg" })}>
            {courseCtaLabel(featured)} <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : showCatalog ? (
          <Link href="/courses" className={buttonVariants({ variant: "glow", size: "lg" })}>
            Explore courses <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
        <a href="#how-it-works" className={buttonVariants({ variant: "outlineInverse", size: "lg" })}>
          See how it works
        </a>
      </div>
    </div>
  );
}

async function HeroAside() {
  const { featured_course: featured } = await getPublicSite();
  return featured ? <FeaturedCourseCard course={featured} /> : <LearningPathCard />;
}

function FeaturedCourseCard({ course }: { course: PublicFeaturedCourse }) {
  return (
    <div className="ar-glass relative animate-scale-in overflow-hidden rounded-2xl shadow-2xl [animation-delay:200ms]">
      {course.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={course.cover_image_url} alt="" className="h-40 w-full object-cover" />
      ) : (
        <div aria-hidden className="ar-grid-bg h-24 bg-gradient-to-br from-brand-700 via-violet-500 to-ink-900 opacity-80" />
      )}
      <div className="p-5">
        <p className="text-xs font-semibold tracking-wider text-volt-400 uppercase">Featured course</p>
        <h2 className="mt-1 font-display text-xl font-bold">{course.title}</h2>
        {course.highlight_badge ? (
          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs">
            <CalendarClock className="size-3.5 text-volt-400" aria-hidden /> {course.highlight_badge}
          </p>
        ) : null}
        {course.short_description ? <p className="mt-3 line-clamp-3 text-sm text-white/70">{course.short_description}</p> : null}
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
          {course.duration_text ? (
            <li className="flex items-center gap-1"><Clock className="size-3.5" aria-hidden /> {course.duration_text}</li>
          ) : null}
          <li className="flex items-center gap-1"><MonitorSmartphone className="size-3.5" aria-hidden /> {deliveryLabel(course.delivery_mode)}</li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/courses/${course.slug}`} className={buttonVariants({ variant: "inverse" })}>
            View course <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

function LearningPathCard() {
  return (
    <Tilt className="hidden lg:block">
      <div className="ar-glass relative animate-float rounded-2xl p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-xs text-white/60">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2">your-learning-path</span>
        </div>
        <ol className="mt-5 space-y-3">
          {["Discover the curriculum", "Attend a free demo", "Join a live batch", "Build real projects", "Interview-ready"].map((s, i) => (
            <li key={s} className="flex animate-fade-up items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5 text-sm" style={{ animationDelay: `${400 + i * 120}ms` }}>
              <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-violet-500 text-xs font-bold">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
    </Tilt>
  );
}

/** Contact section: real settings only; nothing is shown for empty fields. */
async function ContactDetails() {
  const site = await getPublicSite();
  const featured = site.featured_course;
  const wa = whatsappLink(site.whatsapp_number, featured ? `Hi, I'd like to know more about ${featured.title}.` : undefined);
  const tel = telLink(site.contact_phone);
  const contacts = [
    site.contact_email ? { icon: Mail, label: "Email", value: site.contact_email, href: `mailto:${site.contact_email}` } : null,
    tel && site.contact_phone ? { icon: Phone, label: "Call", value: site.contact_phone, href: tel } : null,
    wa && site.whatsapp_number ? { icon: MessageCircle, label: "WhatsApp", value: site.whatsapp_number, href: wa } : null,
  ].filter((c) => c !== null);

  return (
    <>
      <p className="mx-auto mt-4 max-w-2xl text-white/70">
        {featured
          ? `Book a free demo of ${featured.title} in a couple of minutes. We'll get back to you with the demo date and next steps.`
          : site.show_course_catalog
            ? "Browse open programs, watch a demo and register in a couple of minutes. We'll get back to you with batch dates and fees."
            : "Reach out and we'll get back to you with upcoming batches and demo dates."}
      </p>
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        {featured ? (
          <Link href={`/courses/${featured.slug}#register`} className={buttonVariants({ variant: "inverse", size: "lg" })}>
            {courseCtaLabel(featured)} <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
        {site.show_course_catalog ? (
          <Link href="/courses" className={buttonVariants({ variant: featured ? "outlineInverse" : "inverse", size: "lg" })}>
            View all courses <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
      {contacts.length ? (
        <ul className="mt-10 flex flex-col justify-center gap-3 text-left sm:flex-row sm:flex-wrap" aria-label="Contact details">
          {contacts.map(({ icon: Icon, label, value, href }) => (
            <li key={label} className="sm:w-64">
              <a
                href={href}
                {...(href.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="ar-glass flex h-full items-center gap-3 rounded-xl px-4 py-3 transition hover:bg-white/10"
              >
                <Icon className="size-5 shrink-0 text-volt-400" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-xs text-white/55">{label}</span>
                  <span className="block truncate text-sm font-medium">{value}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {site.address ? (
        <p className="mt-6 flex items-start justify-center gap-2 text-sm whitespace-pre-line text-white/60">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {site.address}
        </p>
      ) : null}
    </>
  );
}
