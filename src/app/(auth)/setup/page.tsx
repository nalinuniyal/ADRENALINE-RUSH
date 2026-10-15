import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { Alert } from "@/components/ui/alert";
import { setupMode } from "@/lib/env.server";
import type { Database } from "@/lib/database.types";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-time setup", robots: { index: false } };

export default function SetupPage() {
  return (
    <div className="w-full max-w-lg rounded-2xl border border-white/20 bg-surface/95 p-6 shadow-[0_30px_80px_-20px_rgb(0_22_57/0.8)] backdrop-blur-xl sm:p-8 animate-scale-in">
      <Suspense fallback={<p className="text-sm text-muted">Checking setup status…</p>}>
        <SetupGate />
      </Suspense>
    </div>
  );
}

async function SetupGate() {
  const env = publicEnv();
  const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: required, error } = await supabase.rpc("setup_required");

  if (error) {
    return (
      <Alert tone="danger" title="The database is not reachable or not migrated">
        Run <code>supabase/setup.sql</code> in the Supabase SQL Editor, then check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
      </Alert>
    );
  }
  // Once the business exists, this page no longer exists.
  if (!required) notFound();

  const mode = setupMode();

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Set up Adrenaline Rush</h1>
      <p className="mt-1 text-sm text-muted">
        Create your business and the owner account. This page works once and then disappears.
      </p>
      <SetupForm proof={mode === "local" ? "none" : mode === "token" ? "token" : "secret-key"} />
    </>
  );
}
