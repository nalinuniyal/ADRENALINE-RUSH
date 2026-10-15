import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return <ModulePlaceholder href="/admin/analytics" summary="Business metrics, charts and CSV reports." />;
}
