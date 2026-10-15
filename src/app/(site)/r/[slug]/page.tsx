import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight, ExternalLink, Info, PlayCircle } from "lucide-react";
import { Aurora } from "@/components/fx/aurora";
import { buttonVariants } from "@/components/ui/button";
import { getPublicResource } from "@/lib/data/public-resources";
import { courseCtaLabel } from "@/lib/public-site";
import { autoThumbnail, embedFor, linkHost } from "@/lib/resources/embed";
import { resourceTypeLabel } from "@/lib/resources/types";

// Shared one-to-one with candidates: never indexed.
const NO_INDEX = { index: false, follow: false } as const;

export async function generateMetadata({ params }: PageProps<"/r/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const r = await getPublicResource(slug).catch(() => null);
  if (!r) return { title: "Link not available", robots: NO_INDEX };
  const description = r.description?.slice(0, 200) ?? `${resourceTypeLabel(r.type)} from ${r.organization_name ?? "Adrenaline Rush"}.`;
  const image = r.thumbnail_url ?? autoThumbnail(r.url);
  return {
    title: r.title,
    description,
    robots: NO_INDEX,
    openGraph: { title: r.title, description, type: "website", images: image ? [image] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title: r.title, description },
  };
}

export default function PublicResourcePage({ params }: PageProps<"/r/[slug]">) {
  return (
    <Suspense fallback={<div className="h-[70vh] bg-ink-900" />}>
      <ResourceView params={params} />
    </Suspense>
  );
}

async function ResourceView({ params }: { params: PageProps<"/r/[slug]">["params"] }) {
  const { slug } = await params;
  const r = await getPublicResource(slug);
  if (!r) notFound();
  const embed = embedFor(r.url);
  const host = linkHost(r.url);
  const thumb = r.thumbnail_url ?? autoThumbnail(r.url);

  return (
    <>
      <section className="relative isolate overflow-hidden bg-gradient-to-b from-ink-950 to-ink-900 text-white">
        <Aurora className="opacity-70" />
        <div className="relative mx-auto max-w-5xl px-4 pt-28 pb-12 sm:px-6 sm:pt-32">
          <p className="animate-fade-up text-sm font-semibold tracking-wider text-volt-400 uppercase">{resourceTypeLabel(r.type)}</p>
          <h1 className="mt-2 max-w-3xl animate-fade-up font-display text-3xl font-bold tracking-tight text-balance [animation-delay:60ms] sm:text-4xl">{r.title}</h1>
          {r.organization_name ? <p className="mt-2 animate-fade-up text-white/60 [animation-delay:100ms]">Shared by {r.organization_name}</p> : null}

          <div className="mt-8 animate-scale-in [animation-delay:150ms]">
            {embed ? (
              <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-raised">
                <iframe
                  src={embed.src}
                  title={r.title}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
                />
              </div>
            ) : (
              <div className="ar-glass flex flex-col gap-4 overflow-hidden rounded-2xl p-6 sm:flex-row sm:items-center">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="aspect-video w-full rounded-lg object-cover sm:w-64" referrerPolicy="no-referrer" />
                ) : null}
                <div className="flex-1">
                  <p className="text-sm text-white/70">This resource opens on {host ?? "another site"}.</p>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "glow", size: "lg", className: "mt-3" })}>
                    <ExternalLink className="size-4" aria-hidden /> Open {resourceTypeLabel(r.type).toLowerCase()}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              </div>
            )}
            {embed ? (
              <p className="mt-3 text-sm text-white/60">
                Video not playing?{" "}
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-volt-400 underline-offset-2 hover:underline">
                  Open it on {host}
                </a>
                .
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {r.description ? (
            <section>
              <h2 className="font-display text-xl font-bold text-ink-900">About this {resourceTypeLabel(r.type).toLowerCase()}</h2>
              <p className="mt-3 text-[15px] leading-7 whitespace-pre-line text-[#333]">{r.description}</p>
            </section>
          ) : null}
          {r.access_instructions ? (
            <section className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <h2 className="font-semibold">How to access</h2>
                <p className="mt-1 whitespace-pre-line">{r.access_instructions}</p>
              </div>
            </section>
          ) : null}
          {!r.description && !r.access_instructions ? (
            <p className="text-[15px] text-[#444]">Questions about what you just watched? Book a free live demo and ask the trainer directly.</p>
          ) : null}
        </div>

        <aside className="space-y-4">
          {r.courses.length ? (
            r.courses.map((c) => (
              <div key={c.slug} className="rounded-2xl border border-line bg-surface p-5 shadow-raised">
                <p className="text-xs font-semibold tracking-wider text-brand-700 uppercase">Course</p>
                <h2 className="mt-1 font-display text-lg font-bold text-ink-900">{c.title}</h2>
                {c.short_description ? <p className="mt-2 text-sm text-[#444]">{c.short_description}</p> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {c.registration_open ? (
                    <Link href={`/courses/${c.slug}#register`} className={buttonVariants({ variant: "glow" })}>
                      <PlayCircle className="size-4" aria-hidden /> {courseCtaLabel(c)}
                    </Link>
                  ) : null}
                  <Link href={`/courses/${c.slug}`} className={buttonVariants({ variant: "secondary" })}>
                    Course details <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-raised">
              <h2 className="font-display text-lg font-bold text-ink-900">Want to learn more?</h2>
              <p className="mt-2 text-sm text-[#444]">See our courses and book a free demo class.</p>
              <Link href="/courses" className={buttonVariants({ variant: "glow", className: "mt-4" })}>
                Book a free demo <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
