"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpenCheck } from "lucide-react";
import { saveCurriculum } from "@/app/actions/courses";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { formatDuration, parseCurriculum } from "@/lib/forms/curriculum";

const EXAMPLE = "## Module title\nOptional module description\n- Lesson title (45m)\n- Another lesson (1h 30m)";

export function CurriculumEditor({ courseId, initialText, readOnly = false }: { courseId: string; initialText: string; readOnly?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [result, setResult] = useState<{ ok: boolean; message?: string; lines?: string[] }>();
  const [pending, startTransition] = useTransition();
  const deferred = useDeferredValue(text);
  const { modules, issues } = useMemo(() => parseCurriculum(deferred), [deferred]);
  const lessonCount = modules.reduce((n, m) => n + m.lessons.length, 0);
  const totalMinutes = modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + (l.durationMinutes ?? 0), 0), 0);
  const dirty = text !== saved;

  const save = () => {
    setResult(undefined);
    startTransition(async () => {
      const res = await saveCurriculum(courseId, { text });
      setResult({ ok: res.ok, message: res.message, lines: res.fieldErrors?.text });
      if (res.ok) {
        setSaved(text);
        router.refresh();
      }
    });
  };

  const preview = (
    <div aria-label="Curriculum preview" role="region" className="min-w-0">
      <p className="mb-2 text-xs text-muted">
        {modules.length} module{modules.length === 1 ? "" : "s"} · {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
        {totalMinutes ? ` · ${formatDuration(totalMinutes)} of listed lessons` : ""}
      </p>
      {modules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted">No curriculum yet.</p>
      ) : (
        <ol className="space-y-2">
          {modules.map((m, i) => (
            <li key={`${m.title}-${i}`} className="rounded-lg border border-line bg-surface shadow-card">
              <div className="flex items-center gap-3 px-3 py-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
                <span className="min-w-0 flex-1 font-semibold break-words">{m.title}</span>
                <span className="text-xs whitespace-nowrap text-muted">{m.lessons.length} lessons</span>
              </div>
              {m.description ? <p className="border-t border-line px-3 py-2 text-xs whitespace-pre-line text-muted">{m.description}</p> : null}
              {m.lessons.length ? (
                <ul className="border-t border-line px-3 py-1.5">
                  {m.lessons.map((l, j) => (
                    <li key={`${l.title}-${j}`} className="flex items-center gap-2 py-1 text-sm text-[#444]">
                      <BookOpenCheck className="size-3.5 shrink-0 text-brand-600" aria-hidden />
                      <span className="min-w-0 break-words">{l.title}</span>
                      {l.durationMinutes ? <span className="ml-auto text-xs whitespace-nowrap text-muted">{formatDuration(l.durationMinutes)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  if (readOnly) return preview;

  return (
    <div className="grid gap-4">
      {result?.message ? (
        <Alert tone={result.ok ? "success" : "danger"}>
          {result.message}
          {result.lines?.length ? (
            <ul className="mt-1 list-disc pl-4">
              {result.lines.slice(0, 10).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="curriculum-text" className="text-xs font-medium text-[#444]">
            Curriculum
          </label>
          <Textarea
            id="curriculum-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            spellCheck
            placeholder={EXAMPLE}
            className="font-mono text-[13px] leading-6"
            aria-describedby="curriculum-help curriculum-issues"
            aria-invalid={issues.length > 0}
            disabled={pending}
          />
          <div id="curriculum-help" className="text-xs text-muted">
            <p>
              Start a module with <code className="rounded bg-canvas px-1">## </code>, add lessons with <code className="rounded bg-canvas px-1">- </code>. Add a duration like{" "}
              <code className="rounded bg-canvas px-1">(45m)</code> or <code className="rounded bg-canvas px-1">(1h 30m)</code> at the end of a lesson. Other lines become the module description.
            </p>
          </div>
          <div id="curriculum-issues" aria-live="polite">
            {issues.length ? (
              <ul className="mt-1 list-disc pl-4 text-xs font-medium text-danger-700">
                {issues.slice(0, 8).map((i) => (
                  <li key={`${i.line}-${i.message}`}>
                    Line {i.line}: {i.message}
                  </li>
                ))}
                {issues.length > 8 ? <li>…and {issues.length - 8} more</li> : null}
              </ul>
            ) : null}
          </div>
        </div>
        {preview}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending || !dirty || issues.length > 0} aria-busy={pending}>
          {pending ? "Saving…" : "Save curriculum"}
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setText(saved)} disabled={pending}>
            Discard changes
          </Button>
        ) : null}
        <span className="text-xs text-muted">Saving replaces all modules and lessons of this course.</span>
      </div>
    </div>
  );
}
