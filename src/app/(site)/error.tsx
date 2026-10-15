"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 pt-32 pb-20 sm:px-6">
      <Alert tone="danger" title="This page could not be loaded">
        Please try again in a moment. If you were registering for a course, nothing was submitted.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </section>
  );
}
