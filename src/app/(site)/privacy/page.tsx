import type { Metadata } from "next";
import { PageHero, Prose } from "@/components/public/page-hero";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How Adrenaline Rush collects, uses and protects your personal data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Privacy policy">
        This is a starting template. Have it reviewed for your business and jurisdiction before going live.
      </PageHero>
      <Prose>
        <h2>What we collect</h2>
        <p>
          When you register for a course or ask for a demo we collect the details you enter in the form, such as your
          name, email address, phone number and answers to course questions. We also record which page and campaign link
          brought you to us (for example UTM tags) so we know which channels work.
        </p>
        <h2>Why we use it</h2>
        <ul>
          <li>To contact you about the course you asked about, batches, fees and demos.</li>
          <li>To manage your enrolment, sessions, attendance and payments if you join.</li>
          <li>To send you marketing messages, only if you ticked the marketing consent box.</li>
        </ul>
        <h2>Who can see it</h2>
        <p>
          Only our team members who need it for their role. Access is controlled by role and recorded in an audit log.
          We do not sell your data. Our hosting and database providers process it on our behalf.
        </p>
        <h2>How long we keep it</h2>
        <p>We keep enquiry data for as long as it is useful to respond to you, and student records as long as the law requires.</p>
        <h2>Your choices</h2>
        <ul>
          <li>Stop marketing messages at any time by replying &ldquo;stop&rdquo; or contacting us.</li>
          <li>Ask for a copy of your data, a correction, or deletion of your data by contacting us.</li>
        </ul>
        <h2>Contact</h2>
        <p>Use the contact details on our home page for any privacy request.</p>
      </Prose>
    </>
  );
}
