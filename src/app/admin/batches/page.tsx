import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export const metadata: Metadata = { title: "Batches" };

export default function BatchesPage() {
  return <ModulePlaceholder href="/admin/batches" summary="Cohorts, capacity and enrollments." />;
}
