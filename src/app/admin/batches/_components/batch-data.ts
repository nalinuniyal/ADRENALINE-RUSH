import type { BatchFormInput } from "@/lib/validation/batches";

export function emptyBatchForm(timezone: string, courseId = ""): BatchFormInput {
  return {
    courseId,
    name: "",
    code: "",
    startDate: "",
    endDate: "",
    timezone,
    classDays: [],
    startTime: "",
    endTime: "",
    scheduleNote: "",
    capacity: "",
    deliveryMode: "online",
    instructorId: "",
    defaultMeetingUrl: "",
    status: "planned",
    notes: "",
  };
}

/** Every IANA time zone the runtime knows, business zone first. */
export function timeZoneList(preferred: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return [preferred, ...zones.filter((z) => z !== preferred)];
}
