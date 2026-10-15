import { AlertTriangle, ExternalLink, Link2, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Tells a pasted link apart from a Google-generated Meet link, and flags a failed Google sync. */
export function MeetingBadge({
  source,
  url,
  syncStatus,
  compact = false,
}: {
  source: string | null;
  url: string | null;
  syncStatus?: string | null;
  compact?: boolean;
}) {
  if (source === "google" && !url) {
    return (
      <Badge tone="warning" title="Google Meet requested but no link yet">
        <AlertTriangle className="size-3" aria-hidden /> {compact ? "Meet pending" : "Google Meet not created yet"}
      </Badge>
    );
  }
  if (!url) return compact ? null : <Badge>No meeting link</Badge>;
  if (source === "google") {
    return (
      <Badge tone={syncStatus === "failed" ? "warning" : "success"} title="Created through Google Calendar">
        <Video className="size-3" aria-hidden /> Google Meet
        {syncStatus === "failed" && !compact ? " · sync failed" : ""}
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" title="Link pasted by your team">
      <Link2 className="size-3" aria-hidden /> Manual link
    </Badge>
  );
}

export function MeetingLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-sm break-all text-brand-700 hover:underline">
      {url}
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
