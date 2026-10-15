import type { Metadata } from "next";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access", robots: { index: false } };

export default function NoAccessPage() {
  return (
    <div className="w-full max-w-md rounded-2xl border border-white/20 bg-surface/95 p-6 shadow-[0_30px_80px_-20px_rgb(0_22_57/0.8)] backdrop-blur-xl sm:p-8 animate-scale-in">
      <h1 className="text-xl font-semibold tracking-tight">Your account has no active access</h1>
      <p className="mt-2 text-sm text-muted">
        You are signed in, but you are not an active member of this business, or your role is currently switched
        off. Ask the owner to check your membership in Settings.
      </p>
      <form action={signOut} className="mt-6">
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </div>
  );
}
