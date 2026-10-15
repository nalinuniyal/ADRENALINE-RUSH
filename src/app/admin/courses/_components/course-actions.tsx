"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, CopyPlus, ExternalLink, Link2, Rocket, Trash2, Undo2 } from "lucide-react";
import { cloneCourse, deleteCourse, setCourseStatus, type ActionResult } from "@/app/actions/courses";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import type { CourseStatus } from "@/lib/validation/courses";

export function publicCourseUrl(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${base}/courses/${slug}`;
}

export function CopyLinkButton({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [url, setUrl] = useState("");

  const copy = async () => {
    const link = publicCourseUrl(slug);
    setUrl(link);
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="relative inline-flex flex-col">
      <Button variant="secondary" onClick={copy}>
        {state === "copied" ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        {state === "copied" ? "Link copied" : "Copy public link"}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Public link copied to clipboard" : ""}
      </span>
      {state === "failed" ? (
        <span className="mt-2 flex flex-col gap-1 text-xs">
          <label htmlFor="public-link-fallback" className="text-muted">
            Copy this link manually:
          </label>
          <input
            id="public-link-fallback"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-64 max-w-full rounded border border-line-strong px-2 py-1"
          />
        </span>
      ) : null}
    </span>
  );
}

/** Status, copy, clone and delete actions for the course page header. */
export function CourseActions({
  courseId,
  slug,
  status,
  canManage,
  registrationCount,
}: {
  courseId: string;
  slug: string;
  status: CourseStatus;
  canManage: boolean;
  /** Total registrations, or null when unknown. */
  registrationCount: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult>();
  const [confirm, setConfirm] = useState<"delete" | "archive" | null>(null);

  const run = (fn: () => Promise<ActionResult>, after?: (res: ActionResult) => void) => {
    setResult(undefined);
    startTransition(async () => {
      const res = await fn();
      setConfirm(null);
      if (after && res.ok) {
        after(res);
        return;
      }
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  const canDelete = status === "draft" && registrationCount === 0;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap gap-2">
        {status === "published" ? (
          <>
            <CopyLinkButton slug={slug} />
            <a href={`/courses/${slug}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary" })}>
              <ExternalLink className="size-4" aria-hidden /> View public page<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </>
        ) : null}
        {canManage ? (
          <>
            {status !== "published" ? (
              <Button variant="success" disabled={pending} onClick={() => run(() => setCourseStatus(courseId, "published"))}>
                <Rocket className="size-4" aria-hidden /> Publish
              </Button>
            ) : (
              <Button variant="secondary" disabled={pending} onClick={() => run(() => setCourseStatus(courseId, "draft"))}>
                <Undo2 className="size-4" aria-hidden /> Unpublish
              </Button>
            )}
            {status === "archived" ? (
              <Button variant="secondary" disabled={pending} onClick={() => run(() => setCourseStatus(courseId, "draft"))}>
                <Undo2 className="size-4" aria-hidden /> Restore as draft
              </Button>
            ) : (
              <Button variant="secondary" disabled={pending} onClick={() => setConfirm("archive")} aria-expanded={confirm === "archive"}>
                <Archive className="size-4" aria-hidden /> Archive
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => cloneCourse(courseId), (res) => router.push(`/admin/courses/${res.id}?cloned=${res.message?.includes("could not") ? "partial" : "1"}`))}
            >
              <CopyPlus className="size-4" aria-hidden /> Clone
            </Button>
            {status === "draft" ? (
              <Button
                variant="secondary"
                className="text-danger-700 hover:border-danger-700/40 hover:bg-danger-50"
                disabled={pending}
                onClick={() => setConfirm("delete")}
                aria-expanded={confirm === "delete"}
              >
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      {pending ? (
        <p className="text-xs text-muted" role="status">
          Working…
        </p>
      ) : null}

      {confirm === "archive" ? (
        <div role="group" aria-label="Confirm archive" className="w-full max-w-md rounded-lg border border-line bg-canvas/60 p-3 text-sm sm:text-right">
          <p>Archive this course? It disappears from the public site and stops taking registrations. Existing registrations are kept.</p>
          <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
            <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => run(() => setCourseStatus(courseId, "archived"))}>
              Archive course
            </Button>
          </div>
        </div>
      ) : null}

      {confirm === "delete" ? (
        <div role="group" aria-label="Confirm delete" className="w-full max-w-md rounded-lg border border-danger-700/25 bg-danger-50 p-3 text-sm text-danger-700 sm:text-right">
          {canDelete ? (
            <>
              <p>Delete this draft permanently, including its curriculum and registration form? This cannot be undone.</p>
              <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
                <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteCourse(courseId), () => router.push("/admin/courses"))}>
                  Delete permanently
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                {registrationCount === null
                  ? "This course’s registrations could not be checked, so it cannot be deleted right now."
                  : `This course has ${registrationCount} registration${registrationCount === 1 ? "" : "s"}, so it cannot be deleted. Archive it instead to hide it and keep the history.`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
                <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>
                  Close
                </Button>
                <Button size="sm" onClick={() => setConfirm("archive")}>
                  Archive instead
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {result?.message ? (
        <Alert tone={result.ok ? "success" : "danger"} className="w-full max-w-md">
          {result.message}
        </Alert>
      ) : null}
    </div>
  );
}
