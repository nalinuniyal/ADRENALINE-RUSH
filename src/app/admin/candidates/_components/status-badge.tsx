import { Badge } from "@/components/ui/badge";
import type { LeadStatusColor } from "@/lib/validation/candidates";

export function StatusBadge({ status }: { status: { label: string; color: LeadStatusColor } | null | undefined }) {
  if (!status) return <Badge>No status</Badge>;
  return <Badge tone={status.color}>{status.label}</Badge>;
}

/** Person label for an owner/author id. */
export function personName(map: Map<string, { name: string }>, id: string | null | undefined, fallback = "Unassigned"): string {
  if (!id) return fallback;
  return map.get(id)?.name ?? "Former member";
}
