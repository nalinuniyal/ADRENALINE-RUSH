import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/admin/module-placeholder";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return <ModulePlaceholder href="/admin/calendar" summary="Class sessions, meeting links and attendance." />;
}
