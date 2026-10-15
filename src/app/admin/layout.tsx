import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminShell, AdminShellSkeleton } from "@/components/admin/admin-shell";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Adrenaline Rush Admin" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminShellSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
