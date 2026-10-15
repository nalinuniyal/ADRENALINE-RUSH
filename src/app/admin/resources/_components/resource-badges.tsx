import { Badge } from "@/components/ui/badge";
import { SHARE_METHOD_LABELS, SHARE_STATUS_LABELS, type ShareMethod, type ShareStatus } from "@/lib/resources/types";

export function VisibilityBadges({ visibility, isActive, expiresOn, today }: { visibility: string; isActive: boolean; expiresOn: string | null; today: string }) {
  const expired = expiresOn !== null && expiresOn < today;
  return (
    <>
      {visibility === "shareable" ? <Badge tone="teal">Shareable</Badge> : <Badge>Internal only</Badge>}
      {!isActive ? <Badge tone="warning">Switched off</Badge> : null}
      {expired ? <Badge tone="danger">Expired</Badge> : null}
    </>
  );
}

const STATUS_TONE: Record<ShareStatus, "neutral" | "success" | "danger" | "warning" | "brand"> = {
  copied: "neutral",
  opened: "brand",
  sent: "success",
  failed: "danger",
  not_sent: "warning",
};

export function ShareStatusBadge({ method, status }: { method: string; status: string }) {
  const s = (status in SHARE_STATUS_LABELS ? status : "copied") as ShareStatus;
  const m = (method in SHARE_METHOD_LABELS ? method : "copy_message") as ShareMethod;
  return (
    <Badge tone={STATUS_TONE[s]} title={SHARE_STATUS_LABELS[s]}>
      {m === "email" ? SHARE_STATUS_LABELS[s] : `${SHARE_METHOD_LABELS[m]} · not confirmed`}
    </Badge>
  );
}
