import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export function AccessDenied() {
  return (
    <EmptyState
      icon={<ShieldAlert className="size-6" aria-hidden />}
      title="You don’t have access to this area"
      description="Your role does not include this module. Ask the business owner if you need access."
    />
  );
}
