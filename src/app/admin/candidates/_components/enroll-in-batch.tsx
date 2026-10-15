"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { enrollCandidate, type ActionResult } from "@/app/actions/batches";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";

/** Small "Enroll in batch" control for the candidate profile. */
export function EnrollInBatch({ candidateId, batches }: { candidateId: string; batches: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult>();

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" aria-hidden /> Enroll in batch
      </Button>
    );
  }
  return (
    <div className="grid gap-2">
      {batches.length === 0 ? (
        <p className="text-sm text-muted">No open batches. Create one under Batches first.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="enroll-batch" className="sr-only">
            Batch
          </label>
          <Select id="enroll-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className="w-auto max-w-full">
            <option value="">Choose a batch…</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!batchId || pending}
            onClick={() =>
              start(async () => {
                const res = await enrollCandidate({ batchId, candidateId, status: "active" });
                setResult(res);
                if (res.ok) {
                  setOpen(false);
                  setBatchId("");
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Enrolling…" : "Enroll"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
      {result?.message && !result.ok ? <Alert tone="danger">{result.message}</Alert> : null}
    </div>
  );
}
