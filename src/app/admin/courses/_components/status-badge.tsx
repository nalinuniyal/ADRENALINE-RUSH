import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { CourseStatus } from "@/lib/validation/courses";

const STATUS: Record<CourseStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "warning" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {s.label}
    </Badge>
  );
}

export const STATUS_LABELS: Record<CourseStatus, string> = { draft: "Draft", published: "Published", archived: "Archived" };
