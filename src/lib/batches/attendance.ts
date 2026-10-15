/**
 * Attendance arithmetic shared by batch, session and candidate pages.
 *
 *   Attendance %  = (present + late) ÷ (present + late + absent)
 *                   Excused and unmarked sessions are left out.
 *   Progress      = sessions attended ÷ all scheduled (non-cancelled) sessions
 */

export type AttendanceMark = "present" | "absent" | "late" | "excused";

export const ATTENDANCE_LABELS: Record<AttendanceMark, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
};

export type AttendanceRecord = { candidateId: string; sessionId: string; status: AttendanceMark };

export type AttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  excused: number;
  attended: number;
  /** null when nothing countable has been marked yet. */
  percent: number | null;
};

export function summarize(statuses: readonly AttendanceMark[]): AttendanceSummary {
  const s = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const st of statuses) s[st] += 1;
  const attended = s.present + s.late;
  const counted = attended + s.absent;
  return { ...s, attended, percent: counted ? Math.round((attended / counted) * 100) : null };
}

/** Per-candidate summaries for one batch. Records for sessions not in `sessionIds` are ignored. */
export function summarizeByCandidate(records: readonly AttendanceRecord[], sessionIds?: ReadonlySet<string>): Map<string, AttendanceSummary> {
  const grouped = new Map<string, AttendanceMark[]>();
  for (const r of records) {
    if (sessionIds && !sessionIds.has(r.sessionId)) continue;
    const list = grouped.get(r.candidateId) ?? [];
    list.push(r.status);
    grouped.set(r.candidateId, list);
  }
  return new Map([...grouped].map(([id, list]) => [id, summarize(list)]));
}

export function formatPercent(p: number | null): string {
  return p === null ? "—" : `${p}%`;
}

/** Badge tone for an attendance percentage. */
export function percentTone(p: number | null): "success" | "warning" | "danger" | "neutral" {
  if (p === null) return "neutral";
  if (p >= 75) return "success";
  if (p >= 50) return "warning";
  return "danger";
}
