import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export const metadata: Metadata = { title: "Finance" };

export default function FinancePage() {
  return <ModulePlaceholder href="/admin/finance" summary="Fees, installments, payments, refunds and expenses." />;
}
