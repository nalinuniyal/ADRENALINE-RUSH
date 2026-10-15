import type { Metadata } from "next";
import { Suspense } from "react";
import { getPublicSite } from "@/lib/data/public-site";
import Link from "next/link";
import { Compass, Users, Video, Zap } from "lucide-react";
import { Reveal } from "@/components/fx/reveal";
import { PageHero } from "@/components/public/page-hero";
import { buttonVariants } from "@/components/ui/button";
import { IconTile, type IconTileColor } from "@/components/ui/icon-tile";

export const metadata: Metadata = {
  title: "About",
  description: "Adrenaline Rush runs live, project-based technology training.",
  alternates: { canonical: "/about" },
};

const VALUES: { icon: typeof Zap; color: IconTileColor; title: string; body: string }[] = [
  { icon: Video, color: "blue", title: "Live, not recorded", body: "Every cohort is taught live by a practising instructor, with recordings and notes shared afterwards." },
  { icon: Compass, color: "teal", title: "Built around projects", body: "Each program ends with work you can show: a project, a configuration or a portfolio piece." },
  { icon: Users, color: "violet", title: "Small batches", body: "Batch sizes are capped so there is time for questions, reviews and one-to-one help." },
  { icon: Zap, color: "orange", title: "Career focused", body: "Content follows what teams are hiring for today, and we keep it updated between batches." },
];

const DEFAULT_ABOUT =
  "Adrenaline Rush runs live training programs, corporate workshops and customised sessions for people who want practical, job-ready skills.";

/** Settings › Website › About text, keeping line breaks as paragraphs. */
async function AboutText() {
  const site = await getPublicSite();
  const paragraphs = (site.about_text ?? DEFAULT_ABOUT).split(/\n\s*\n/).filter(Boolean);
  return (
    <div className="grid gap-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About us" title="Training that moves at the speed of your career">
        <Suspense fallback={<p>{DEFAULT_ABOUT}</p>}>
          <AboutText />
        </Suspense>
      </PageHero>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 sm:px-6">
        {VALUES.map((v, i) => (
          <Reveal key={v.title} delay={i * 80}>
            <div className="ar-lift h-full rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-card">
              <IconTile icon={v.icon} color={v.color} size="lg" />
              <h2 className="mt-4 font-display text-lg font-bold text-ink-900">{v.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{v.body}</p>
            </div>
          </Reveal>
        ))}
      </section>
      <section className="mx-auto max-w-6xl px-4 pb-16 text-center sm:px-6">
        <Link href="/courses" className={buttonVariants({ size: "lg" })}>
          Browse courses
        </Link>
      </section>
    </>
  );
}
