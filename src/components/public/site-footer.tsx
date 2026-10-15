import { Suspense } from "react";
import Link from "next/link";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { EMPTY_PUBLIC_SITE, getPublicSite, telLink, whatsappLink, type PublicSite } from "@/lib/data/public-site";

const SOCIAL_LABELS: Record<keyof PublicSite["social"], string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  facebook: "Facebook",
};

/** A normal website footer: brand, a few links, contact details from Settings › Website. */
export function SiteFooter() {
  return (
    <Suspense fallback={<FooterContent site={EMPTY_PUBLIC_SITE} />}>
      <FooterWithSettings />
    </Suspense>
  );
}

async function FooterWithSettings() {
  return <FooterContent site={await getPublicSite()} />;
}

function FooterContent({ site }: { site: PublicSite }) {
  const name = site.organization_name ?? "Adrenaline Rush";
  const tel = telLink(site.contact_phone);
  const wa = whatsappLink(site.whatsapp_number);
  const socials = (Object.keys(SOCIAL_LABELS) as (keyof PublicSite["social"])[]).filter((k) => site.social[k]);
  const hasContact = Boolean(site.contact_email || tel || wa || site.address);
  const links = [
    { href: "/", label: "Home" },
    ...(site.show_course_catalog ? [{ href: "/courses", label: "Courses" }] : []),
    { href: "/about", label: "About" },
    { href: "/faq", label: "FAQs" },
    { href: "/#contact", label: "Contact" },
  ];

  return (
    <footer className="relative bg-ink-950 text-sm text-white/60">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo inverse />
          <p className="mt-3 max-w-xs">{site.footer_tagline ?? "Career-focused technology training with live cohorts and real projects."}</p>
          {socials.length ? (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Social media">
              {socials.map((k) => (
                <li key={k}>
                  <a
                    href={site.social[k]!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 transition hover:border-white/40 hover:text-white"
                  >
                    {SOCIAL_LABELS[k]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <nav aria-label="Footer">
          <h2 className="text-xs font-semibold tracking-wider text-white uppercase">Explore</h2>
          <ul className="mt-3 grid gap-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="transition hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {hasContact ? (
          <div>
            <h2 className="text-xs font-semibold tracking-wider text-white uppercase">Contact</h2>
            <ul className="mt-3 grid gap-2">
              {site.contact_email ? (
                <li>
                  <a href={`mailto:${site.contact_email}`} className="inline-flex items-center gap-2 transition hover:text-white">
                    <Mail className="size-4" aria-hidden /> {site.contact_email}
                  </a>
                </li>
              ) : null}
              {tel ? (
                <li>
                  <a href={tel} className="inline-flex items-center gap-2 transition hover:text-white">
                    <Phone className="size-4" aria-hidden /> {site.contact_phone}
                  </a>
                </li>
              ) : null}
              {wa ? (
                <li>
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 transition hover:text-white">
                    <MessageCircle className="size-4" aria-hidden /> WhatsApp
                  </a>
                </li>
              ) : null}
              {site.address ? (
                <li className="inline-flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{site.address}</span>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs sm:flex-row sm:px-6">
          <p>
            © <CopyrightYear /> {name}. All rights reserved.
          </p>
          <p className="flex gap-4">
            <Link href="/privacy" className="hover:text-white">
              Privacy policy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

async function CopyrightYear() {
  "use cache";
  return <>{new Date().getFullYear()}</>;
}
