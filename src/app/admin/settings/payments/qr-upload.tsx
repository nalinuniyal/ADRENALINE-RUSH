"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";
import { removePaymentQr, uploadPaymentQr, type UpiActionResult } from "@/app/actions/finance-upi";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function QrUpload({ current }: { current: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<UpiActionResult>();

  const upload = (file: File) => {
    setResult(undefined);
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await uploadPaymentQr(fd);
      setResult(res);
      if (res.ok) router.refresh();
      if (input.current) input.current.value = "";
    });
  };
  const remove = () => {
    setResult(undefined);
    start(async () => {
      const res = await removePaymentQr();
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-start gap-4">
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded media
        <img src={current} alt="Your uploaded UPI QR image" className="max-h-40 w-auto rounded border border-line bg-white" />
      ) : null}
      <div className="grid gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          id="qr-file"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) upload(f);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => input.current?.click()}>
            <Upload className="size-4" aria-hidden /> {current ? "Replace QR image" : "Upload QR image"}
          </Button>
          {current ? (
            <Button variant="ghost" size="sm" className="text-danger-700" disabled={pending} onClick={remove}>
              <Trash2 className="size-4" aria-hidden /> Remove
            </Button>
          ) : null}
        </div>
        {result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      </div>
    </div>
  );
}
