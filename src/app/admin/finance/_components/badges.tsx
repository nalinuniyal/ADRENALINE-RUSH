import { Badge, type BadgeTone } from "@/components/ui/badge";
import { INSTALLMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS, type InstallmentStatus, type PaymentDisplayStatus } from "@/lib/finance/money";

const INSTALLMENT_TONES: Record<InstallmentStatus, BadgeTone> = { paid: "success", partially_paid: "warning", due: "brand", overdue: "danger" };
const PAYMENT_TONES: Record<PaymentDisplayStatus, BadgeTone> = {
  completed: "success",
  pending: "warning",
  failed: "danger",
  voided: "neutral",
  partially_refunded: "violet",
  refunded: "violet",
};

export function InstallmentStatusBadge({ status }: { status: InstallmentStatus }) {
  return <Badge tone={INSTALLMENT_TONES[status] ?? "neutral"}>{INSTALLMENT_STATUS_LABELS[status] ?? status}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentDisplayStatus }) {
  return <Badge tone={PAYMENT_TONES[status] ?? "neutral"}>{PAYMENT_STATUS_LABELS[status] ?? status}</Badge>;
}

/** Overall state of a fee plan for lists. */
export function FeeStateBadge({ outstanding, overdue, hasPlan }: { outstanding: number; overdue: boolean; hasPlan: boolean }) {
  if (!hasPlan) return <Badge>No fee set</Badge>;
  if (outstanding <= 0) return <Badge tone="success">Paid in full</Badge>;
  return overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="warning">Balance due</Badge>;
}
