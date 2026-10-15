"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, Trash2 } from "lucide-react";
import { deleteResource, setResourceActive, type ResourceActionResult } from "@/app/actions/resources";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Switch on/off and delete, for the resource page header. */
export function ResourceActions({ resourceId, isActive, shares }: { resourceId: string; isActive: boolean; shares: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResourceActionResult>();
  const [confirm, setConfirm] = useState(false);

  const run = (fn: () => Promise<ResourceActionResult>, after?: () => void) => {
    setResult(undefined);
    startTransition(async () => {
      const res = await fn();
      if (res.ok && after) return after();
      setConfirm(false);
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => run(() => setResourceActive(resourceId, !isActive))}>
          <Power className="size-4" aria-hidden /> {isActive ? "Switch off" : "Switch on"}
        </Button>
        <Button variant="secondary" className="text-danger-700 hover:border-danger-700/40 hover:bg-danger-50" disabled={pending} onClick={() => setConfirm(true)} aria-expanded={confirm}>
          <Trash2 className="size-4" aria-hidden /> Delete
        </Button>
      </div>
      {confirm ? (
        <div role="group" aria-label="Confirm delete" className="w-full max-w-md rounded-lg border border-danger-700/25 bg-danger-50 p-3 text-sm text-danger-700 sm:text-right">
          <p>
            Delete this resource? Its public link stops working immediately.
            {shares ? ` It was shared ${shares} time${shares === 1 ? "" : "s"}; that history is kept.` : ""} Switching it off is reversible.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
            <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteResource(resourceId), () => router.push("/admin/resources"))}>
              Delete permanently
            </Button>
          </div>
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
