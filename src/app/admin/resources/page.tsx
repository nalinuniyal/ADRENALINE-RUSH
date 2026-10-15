import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export const metadata: Metadata = { title: "Resources" };

export default function ResourcesPage() {
  return <ModulePlaceholder href="/admin/resources" summary="Demo videos, documents, links and sharing history." />;
}
