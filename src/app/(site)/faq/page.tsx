import type { Metadata } from "next";
import { PageHero } from "@/components/public/page-hero";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers to common questions about courses, registration, batches and payments.",
  alternates: { canonical: "/faq" },
};

const FAQS = [
  {
    q: "How do I register for a course?",
    a: "Open the course page and fill in the registration form. We will contact you with batch dates, fees and next steps. Registering does not commit you to pay.",
  },
  {
    q: "Are classes live or recorded?",
    a: "Each course page shows its delivery mode: online live, in person, hybrid or self-paced. Live sessions run on Google Meet or another link shared with your batch.",
  },
  {
    q: "Can I attend a demo before joining?",
    a: "Many courses offer a demo session or recording. If a course has one, the registration form lets you ask for it.",
  },
  {
    q: "Can I pay in instalments?",
    a: "Instalment plans are available for many programs. Ask during counselling and we will share the schedule in writing before you pay.",
  },
  {
    q: "What happens if I miss a session?",
    a: "Your instructor shares notes and, where available, a recording. Attendance is tracked so you and your instructor can see what to catch up on.",
  },
  {
    q: "How do I stop receiving messages or delete my data?",
    a: "Reply to any message asking us to stop, or contact us using the details on our home page. See the privacy policy for how to request access to or deletion of your data.",
  },
];

export default function FaqPage() {
  return (
    <>
      <PageHero eyebrow="Help" title="Frequently asked questions" />
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-5 py-4 open:bg-brand-50/40">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden className="text-brand-600 transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
