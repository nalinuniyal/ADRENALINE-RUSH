import { Reveal } from "@/components/fx/reveal";
import { Spotlight } from "@/components/fx/spotlight";
import { InclusionIcon } from "@/components/public/inclusion-icon";
import type { PublicInclusion } from "@/lib/data/public-courses";

/** Lightning object-icon colours, cycled so neighbouring tiles differ. */
const TILE_COLORS = ["bg-[#0176d3]", "bg-[#06a59a]", "bg-[#9050e9]", "bg-[#fe9339]", "bg-[#2e844a]", "bg-[#5867e8]"] as const;

/** "What's included" icon grid on the course page. Renders nothing when the list is empty. */
export function CourseInclusions({ items, title = "What's included" }: { items: PublicInclusion[]; title?: string }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="whats-included">
      <Reveal>
        <h2 id="whats-included" className="font-display text-2xl font-bold text-ink-900">
          {title}
        </h2>
      </Reveal>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2">
        {items.map((item, i) => (
          <Reveal as="li" key={`${item.title}-${i}`} delay={(i % 4) * 70}>
            <Spotlight className="ar-lift flex h-full gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
              <span className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${TILE_COLORS[i % TILE_COLORS.length]}`}>
                <InclusionIcon name={item.icon} className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-ink-900">{item.title}</h3>
                {item.description ? <p className="mt-1 text-sm text-muted">{item.description}</p> : null}
              </div>
            </Spotlight>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}
