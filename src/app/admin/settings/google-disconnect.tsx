"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGoogleAction } from "@/app/actions/google";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function DisconnectGoogleButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();

  if (result) return <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert>;
  if (!confirm) {
    return (
      <Button size="sm" variant="secondary" className="text-danger-700" onClick={() => setConfirm(true)}>
        Disconnect
      </Button>
    );
  }
  return (
    <span role="group" aria-label="Confirm disconnect" className="flex flex-wrap items-center gap-2 text-xs">
      <span>Existing Meet links keep working.</span>
      <Button size="xs" variant="secondary" onClick={() => setConfirm(false)}>
        Keep
      </Button>
      <Button
        size="xs"
        variant="danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(await disconnectGoogleAction());
            router.refresh();
          })
        }
      >
        {pending ? "Disconnecting…" : "Disconnect"}
      </Button>
    </span>
  );
}
