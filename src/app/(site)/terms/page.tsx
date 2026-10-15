import type { Metadata } from "next";
import { PageHero, Prose } from "@/components/public/page-hero";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using the Adrenaline Rush website and registering for courses.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Terms of use">
        This is a starting template. Have it reviewed for your business and jurisdiction before going live.
      </PageHero>
      <Prose>
        <h2>Registrations</h2>
        <p>
          Submitting a registration form is an enquiry, not a purchase. Fees, batch dates and refund terms are confirmed
          in writing before you pay.
        </p>
        <h2>Payments and refunds</h2>
        <p>Payment schedules, instalments and refund eligibility are shared with your enrolment confirmation.</p>
        <h2>Course content</h2>
        <p>
          Course material, recordings and resources are for your personal learning. Please do not share links or
          recordings outside your batch.
        </p>
        <h2>Changes</h2>
        <p>We may reschedule sessions or update content. We will tell your batch in advance whenever we can.</p>
      </Prose>
    </>
  );
}
