import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatPercent, percentTone } from "@/lib/batches/attendance";
import {
  BATCH_STATUS_LABELS,
  ENROLLMENT_STATUS_LABELS,
  SESSION_STATUS_LABELS,
  type BatchStatus,
  type EnrollmentStatus,
  type SessionStatus,
} from "@/lib/validation/batches";

const BATCH_TONES: Record<BatchStatus, BadgeTone> = {
  planned: "neutral",
  open: "brand",
  full: "warning",
  running: "success",
  completed: "teal",
  cancelled: "danger",
};

const ENROLLMENT_TONES: Record<EnrollmentStatus, BadgeTone> = {
  pending: "warning",
  active: "success",
  on_hold: "violet",
  completed: "teal",
  dropped: "neutral",
  cancelled: "danger",
};

const SESSION_TONES: Record<SessionStatus, BadgeTone> = { scheduled: "brand", completed: "success", cancelled: "danger" };

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return <Badge tone={BATCH_TONES[status] ?? "neutral"}>{BATCH_STATUS_LABELS[status] ?? status}</Badge>;
}

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return <Badge tone={ENROLLMENT_TONES[status] ?? "neutral"}>{ENROLLMENT_STATUS_LABELS[status] ?? status}</Badge>;
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return <Badge tone={SESSION_TONES[status] ?? "neutral"}>{SESSION_STATUS_LABELS[status] ?? status}</Badge>;
}

export function PercentBadge({ percent, label }: { percent: number | null; label?: string }) {
  return (
    <Badge tone={percentTone(percent)} title={label}>
      {formatPercent(percent)}
      {label ? <span className="sr-only"> {label}</span> : null}
    </Badge>
  );
}

/** Seats used, e.g. "12 / 20" or "12 enrolled" with no limit. */
export function seatsText(taken: number, capacity: number | null): string {
  return capacity ? `${taken} / ${capacity}` : `${taken} enrolled`;
}
