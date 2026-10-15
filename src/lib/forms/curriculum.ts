/**
 * Plain-text curriculum format used by the admin course editor.
 *
 *   ## Module title
 *   Optional description lines for the module.
 *   - Lesson title (45m)
 *   - Another lesson (1h 30m)
 *
 * Lines starting with "## " start a module, lines starting with "- " (or "* ")
 * are lessons of the current module, other non-blank lines are the module's
 * description. A trailing "(45m)", "(45 min)", "(1h)" or "(1h 30m)" on a
 * lesson sets its duration in minutes.
 */

export type CurriculumLesson = { title: string; durationMinutes: number | null };
export type CurriculumModule = { title: string; description: string | null; lessons: CurriculumLesson[] };
export type CurriculumIssue = { line: number; message: string };

export const CURRICULUM_LIMITS = {
  modules: 100,
  lessonsPerModule: 200,
  title: 200,
  description: 2000,
  durationMinutes: 10_000,
  textLength: 100_000,
} as const;

const MODULE_RE = /^##\s+(.*)$/;
const LESSON_RE = /^[-*]\s+(.*)$/;
const DURATION_RE = /\s*\(\s*(?:(\d{1,4})\s*h(?:ours?|rs?)?)?\s*(?:(\d{1,5})\s*m(?:in(?:ute)?s?)?)?\s*\)\s*$/i;

/** Splits "Lesson title (1h 30m)" into its title and duration in minutes. */
export function parseLessonLine(raw: string): CurriculumLesson {
  const text = raw.trim();
  const m = DURATION_RE.exec(text);
  if (m && (m[1] !== undefined || m[2] !== undefined)) {
    const minutes = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
    const title = text.slice(0, m.index).trim();
    if (title) return { title, durationMinutes: minutes > 0 ? minutes : null };
  }
  return { title: text, durationMinutes: null };
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function parseCurriculum(text: string): { modules: CurriculumModule[]; issues: CurriculumIssue[] } {
  const modules: CurriculumModule[] = [];
  const issues: CurriculumIssue[] = [];
  const descriptions: string[][] = [];

  if (text.length > CURRICULUM_LIMITS.textLength) {
    return { modules: [], issues: [{ line: 1, message: "The curriculum is too long. Split it into fewer, shorter lines." }] };
  }

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNo = index + 1;
    if (!line) return;

    const moduleMatch = MODULE_RE.exec(line);
    if (moduleMatch || line === "##") {
      const title = (moduleMatch?.[1] ?? "").trim();
      if (!title) {
        issues.push({ line: lineNo, message: "Module heading needs a title after “## ”." });
        return;
      }
      if (title.length > CURRICULUM_LIMITS.title) {
        issues.push({ line: lineNo, message: `Module title is longer than ${CURRICULUM_LIMITS.title} characters.` });
      }
      if (modules.length === CURRICULUM_LIMITS.modules) {
        issues.push({ line: lineNo, message: `A course can have at most ${CURRICULUM_LIMITS.modules} modules.` });
      }
      modules.push({ title, description: null, lessons: [] });
      descriptions.push([]);
      return;
    }

    const current = modules.at(-1);
    const lessonMatch = LESSON_RE.exec(line);
    if (lessonMatch || line === "-" || line === "*") {
      if (!current) {
        issues.push({ line: lineNo, message: "Lessons must come after a module heading (a line starting with “## ”)." });
        return;
      }
      const lesson = parseLessonLine(lessonMatch?.[1] ?? "");
      if (!lesson.title) {
        issues.push({ line: lineNo, message: "Lesson needs a title after “- ”." });
        return;
      }
      if (lesson.title.length > CURRICULUM_LIMITS.title) {
        issues.push({ line: lineNo, message: `Lesson title is longer than ${CURRICULUM_LIMITS.title} characters.` });
      }
      if (lesson.durationMinutes !== null && lesson.durationMinutes > CURRICULUM_LIMITS.durationMinutes) {
        issues.push({ line: lineNo, message: "Lesson duration is too long." });
      }
      if (current.lessons.length === CURRICULUM_LIMITS.lessonsPerModule) {
        issues.push({ line: lineNo, message: `A module can have at most ${CURRICULUM_LIMITS.lessonsPerModule} lessons.` });
      }
      current.lessons.push(lesson);
      return;
    }

    if (!current) {
      issues.push({ line: lineNo, message: "Start with a module heading, e.g. “## Introduction”." });
      return;
    }
    descriptions[descriptions.length - 1].push(line);
  });

  modules.forEach((m, i) => {
    const description = descriptions[i].join("\n").trim();
    m.description = description || null;
    if (description.length > CURRICULUM_LIMITS.description) {
      issues.push({ line: 1, message: `The description of “${m.title.slice(0, 40)}” is longer than ${CURRICULUM_LIMITS.description} characters.` });
    }
  });

  return { modules, issues };
}

/** Inverse of parseCurriculum, used to prefill the editor. */
export function serializeCurriculum(modules: CurriculumModule[]): string {
  return modules
    .map((m) => {
      const lines = [`## ${m.title}`];
      if (m.description) lines.push(...m.description.split("\n"));
      for (const l of m.lessons) lines.push(`- ${l.title}${l.durationMinutes ? ` (${formatDuration(l.durationMinutes)})` : ""}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
