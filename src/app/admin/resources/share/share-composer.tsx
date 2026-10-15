"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Link2, Mail, MessageCircle, Search, UserPlus, X } from "lucide-react";
import { searchShareCandidates, shareResources, type ShareActionResult, type ShareCandidate } from "@/app/actions/resources";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { whatsappChatLink } from "@/lib/public-site";
import { buildShareVariables, linksForCopy, renderShareMessage, WHATSAPP_MAX_MESSAGE, type LinkMode, type ShareResource } from "@/lib/resources/message";
import { resourceTypeLabel, TEMPLATE_CHANNEL_LABELS, type ShareMethod, type TemplateChannel } from "@/lib/resources/types";
import { cn } from "@/lib/utils";

type Resource = ShareResource & { type: string; courseIds: string[] };
type Template = { id: string; name: string; channel: string; subject: string | null; body: string };
type Course = { id: string; title: string; slug: string; status: string };

const BLANK_BODY = "Hi {{first_name}},\n\n{{resource_links}}\n\n{{sender_name}}, {{business_name}}";

export function ShareComposer({
  resources,
  templates,
  courses,
  initialCandidates,
  initialResourceIds,
  defaultCourseId,
  siteUrl,
  businessName,
  senderName,
  countryCode,
  emailConfigured,
  canMarkStatus,
}: {
  resources: Resource[];
  templates: Template[];
  courses: Course[];
  initialCandidates: ShareCandidate[];
  initialResourceIds: string[];
  defaultCourseId: string;
  siteUrl: string;
  businessName: string;
  senderName: string;
  countryCode: string;
  emailConfigured: boolean;
  canMarkStatus: boolean;
}) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<ShareCandidate[]>(initialCandidates);
  const [selected, setSelected] = useState<string[]>(initialResourceIds);
  const firstTemplate = templates.find((t) => t.channel !== "email") ?? templates[0];
  const [templateId, setTemplateId] = useState(firstTemplate?.id ?? "");
  const [body, setBody] = useState(firstTemplate?.body ?? BLANK_BODY);
  const [subject, setSubject] = useState(firstTemplate?.subject ?? "Resources from {{business_name}}");
  const [courseId, setCourseId] = useState(defaultCourseId);
  const [linkMode, setLinkMode] = useState<LinkMode>("page");
  const [previewId, setPreviewId] = useState<string | null>(initialCandidates[0]?.id ?? null);
  const [markDemoShared, setMarkDemoShared] = useState(false);
  const [resourceFilter, setResourceFilter] = useState("");
  const [result, setResult] = useState<ShareActionResult>();
  const [done, setDone] = useState<Record<string, ShareMethod[]>>({});
  const [confirmEmail, setConfirmEmail] = useState(false);
  const [pending, startTransition] = useTransition();

  const chosen = useMemo(() => resources.filter((r) => selected.includes(r.id)), [resources, selected]);
  const course = courses.find((c) => c.id === courseId) ?? null;
  const shareCourse = course ? { title: course.title, slug: course.slug, published: course.status === "published" } : null;
  const previewCandidate = candidates.find((c) => c.id === previewId) ?? candidates[0] ?? null;
  const messageFor = (c: { full_name: string } | null) =>
    renderShareMessage(body, buildShareVariables({ siteUrl, businessName, senderName, candidate: c, course: shareCourse, resources: chosen, linkMode }));
  const preview = messageFor(previewCandidate);
  const previewSubject = renderShareMessage(subject || "Resources from {{business_name}}", buildShareVariables({ siteUrl, businessName, senderName, candidate: previewCandidate, course: shareCourse, resources: chosen, linkMode })).replace(/\s+/g, " ");
  const links = linksForCopy(chosen, siteUrl, linkMode);
  const ready = chosen.length > 0 && body.trim().length > 0;
  const bulk = candidates.length > 1;

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setBody(t.body);
      if (t.subject) setSubject(t.subject);
    }
  };

  const toggleResource = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 20);
    setSelected(next);
    // Default the course to the first chosen resource's course.
    if (!courseId) {
      const first = resources.find((r) => next.includes(r.id) && r.courseIds.length);
      const cid = first?.courseIds.find((c) => courses.some((x) => x.id === c));
      if (cid) setCourseId(cid);
    }
  };

  const record = (method: ShareMethod, candidateIds: string[], after?: (res: ShareActionResult) => void) => {
    setResult(undefined);
    startTransition(async () => {
      const res = await shareResources({ candidateIds, resourceIds: chosen.map((r) => r.id), templateId, courseId, linkMode, subject, body, method, markDemoShared });
      setResult(res);
      if (res.ok) {
        setDone((d) => {
          const next = { ...d };
          for (const o of res.outcomes ?? []) if (o.candidateId && o.status !== "skipped") next[o.candidateId] = [...(next[o.candidateId] ?? []), method];
          if (!candidateIds.length) next[""] = [...(next[""] ?? []), method];
          return next;
        });
        router.refresh();
      }
      after?.(res);
    });
  };

  const copy = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      setResult({ ok: false, message: "The browser blocked copying. Select the preview text and copy it by hand. Nothing was recorded." });
      return false;
    }
  };

  const copyMessage = async (c: ShareCandidate | null) => {
    if (await copy(messageFor(c))) record("copy_message", c ? [c.id] : []);
  };
  const copyLinks = async () => {
    if (await copy(links)) record("copy_link", candidates.filter((c) => !c.do_not_contact).map((c) => c.id));
  };
  const openWhatsApp = (c: ShareCandidate) => {
    const link = whatsappChatLink(c.phone, messageFor(c), countryCode);
    if (!link.ok) return setResult({ ok: false, message: `${c.full_name}: ${link.reason}` });
    // Opened synchronously so popup blockers allow it; the share is recorded right after.
    window.open(link.url, "_blank", "noopener,noreferrer");
    record("whatsapp", [c.id]);
  };

  const emailable = candidates.filter((c) => !c.do_not_contact && c.email);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
      <div className="grid min-w-0 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>1. Who</CardTitle>
            <CardDescription>Add one or more candidates, or leave empty to copy a message for a group or post.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <CandidatePicker
              selectedIds={candidates.map((c) => c.id)}
              onAdd={(c) => {
                setCandidates((cur) => (cur.some((x) => x.id === c.id) || cur.length >= 50 ? cur : [...cur, c]));
                setPreviewId((p) => p ?? c.id);
              }}
            />
            {candidates.length ? (
              <ul className="grid gap-2" aria-label="Selected candidates">
                {candidates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <Link href={`/admin/candidates/${c.id}`} className="font-medium text-brand-700 hover:underline">
                        {c.full_name}
                      </Link>
                      <span className="block text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "No phone or email"}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {c.do_not_contact ? <Badge tone="danger">Do not contact</Badge> : null}
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setCandidates((cur) => cur.filter((x) => x.id !== c.id));
                          if (previewId === c.id) setPreviewId(null);
                        }}
                      >
                        <X className="size-3.5" aria-hidden />
                        <span className="sr-only">Remove {c.full_name}</span>
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. What</CardTitle>
            <CardDescription>
              {selected.length ? `${selected.length} selected` : "Choose one or more"} · only shareable, switched-on resources are listed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {resources.length > 6 ? (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input type="search" aria-label="Filter resources" placeholder="Filter by title" value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className="pl-9" />
              </div>
            ) : null}
            <ul className="grid max-h-80 gap-1 overflow-y-auto" aria-label="Resources">
              {resources
                .filter((r) => !resourceFilter || r.title.toLowerCase().includes(resourceFilter.toLowerCase()) || selected.includes(r.id))
                .map((r) => (
                  <li key={r.id}>
                    <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm", selected.includes(r.id) ? "border-brand-400 bg-brand-50/60" : "border-line hover:bg-canvas")}>
                      <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={selected.includes(r.id)} onChange={() => toggleResource(r.id)} />
                      <span className="min-w-0">
                        <span className="font-medium break-words">{r.title}</span>
                        <span className="block text-xs text-muted">
                          {resourceTypeLabel(r.type)}
                          {r.courseIds.length ? ` · ${r.courseIds.map((id) => courses.find((c) => c.id === id)?.title).filter(Boolean).join(", ")}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Message</CardTitle>
            <CardDescription>
              Pick a template and adjust the text if you like. <Link href="/admin/resources/templates" className="text-brand-700 hover:underline">Manage templates</Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field id="share-template" label="Template">
              <Select id="share-template" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                <option value="">No template (write your own)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {TEMPLATE_CHANNEL_LABELS[t.channel as TemplateChannel] ?? t.channel}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="share-course" label="Course in the message">
              <Select id="share-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">No specific course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                    {c.status !== "published" ? " (not published)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-xs font-medium text-[#444]">Links point to</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="link-mode" className="size-4 accent-brand-600" checked={linkMode === "page"} onChange={() => setLinkMode("page")} />
                  Your branded page (recommended)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="link-mode" className="size-4 accent-brand-600" checked={linkMode === "direct"} onChange={() => setLinkMode("direct")} />
                  The original link (YouTube, Drive…)
                </label>
              </div>
            </fieldset>
            <Field id="share-subject" label="Email subject" className="sm:col-span-2">
              <Input id="share-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field id="share-body" label="Message" className="sm:col-span-2" hint="Placeholders such as {{first_name}} are filled in for each candidate.">
              <Textarea id="share-body" rows={9} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 lg:sticky lg:top-4">
        <Card>
          <CardHeader>
            <CardTitle>4. Preview and share</CardTitle>
            <CardDescription>
              {previewCandidate ? `As ${previewCandidate.full_name} will see it` : "Without a candidate, {{first_name}} becomes “there”."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {bulk ? (
              <Field id="share-preview-for" label="Preview for">
                <Select id="share-preview-for" value={previewCandidate?.id ?? ""} onChange={(e) => setPreviewId(e.target.value)}>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <div className="rounded-xl bg-[#e7ddd3] p-3" aria-live="polite">
              <div className="ml-auto max-w-[92%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm break-words whitespace-pre-wrap text-[#111b21] shadow-sm" data-testid="share-preview">
                {ready ? preview : <span className="text-[#54656f]">Choose at least one resource to see the message.</span>}
              </div>
            </div>
            <p className="text-xs text-muted">
              Email subject: {previewSubject} · {preview.length} characters
            </p>
            {preview.length > WHATSAPP_MAX_MESSAGE ? (
              <Alert tone="warning">This message is long for WhatsApp ({preview.length} characters). Shorten it if WhatsApp does not open with the text filled in.</Alert>
            ) : null}

            {canMarkStatus && candidates.length ? (
              <Checkbox
                id="mark-demo-shared"
                label="Move to “Demo Shared” status"
                description="Only candidates in an earlier, open stage are moved."
                checked={markDemoShared}
                onChange={(e) => setMarkDemoShared(e.currentTarget.checked)}
              />
            ) : null}

            {result?.message ? (
              <Alert tone={result.ok ? "success" : "danger"}>
                <p>{result.message}</p>
                {result.outcomes?.some((o) => o.status === "skipped" || o.status === "failed") ? (
                  <ul className="mt-1 list-disc pl-4">
                    {result.outcomes
                      .filter((o) => o.status === "skipped" || o.status === "failed")
                      .map((o, i) => (
                        <li key={`${o.candidateId}-${i}`}>
                          {o.name ?? "Candidate"}: {o.error ?? o.status}
                        </li>
                      ))}
                  </ul>
                ) : null}
              </Alert>
            ) : null}

            {candidates.length === 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={!ready || pending} onClick={() => copyMessage(null)}>
                  <Copy className="size-4" aria-hidden /> Copy message
                </Button>
                <Button variant="secondary" disabled={!chosen.length || pending} onClick={copyLinks}>
                  <Link2 className="size-4" aria-hidden /> Copy {chosen.length > 1 ? "links" : "link"}
                </Button>
              </div>
            ) : (
              <>
                <ul className="grid gap-2" aria-label="Share with each candidate">
                  {candidates.map((c) => {
                    const wa = whatsappChatLink(c.phone, "", countryCode);
                    const did = done[c.id] ?? [];
                    return (
                      <li key={c.id} className="rounded-lg border border-line p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium">{c.full_name}</span>
                          {did.length ? (
                            <Badge tone="success">
                              <Check className="size-3" aria-hidden /> Recorded: {[...new Set(did)].map((m) => (m === "whatsapp" ? "WhatsApp opened" : m === "email" ? "email" : "copied")).join(", ")}
                            </Badge>
                          ) : null}
                        </div>
                        {c.do_not_contact ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-danger-700">
                            <AlertTriangle className="size-3.5" aria-hidden /> Marked do not contact. Sharing is disabled.
                          </p>
                        ) : (
                          <>
                            {!wa.ok ? <p className="mt-1 text-xs text-warning-700">WhatsApp: {wa.reason} Edit the phone number on the candidate’s profile.</p> : null}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button size="sm" variant="success" disabled={!ready || pending || !wa.ok} onClick={() => openWhatsApp(c)}>
                                <MessageCircle className="size-4" aria-hidden /> Open WhatsApp<span className="sr-only"> for {c.full_name}</span>
                              </Button>
                              <Button size="sm" variant="secondary" disabled={!ready || pending} onClick={() => copyMessage(c)}>
                                <Copy className="size-4" aria-hidden /> Copy message<span className="sr-only"> for {c.full_name}</span>
                              </Button>
                            </div>
                            {wa.ok ? <p className="mt-1 text-xs text-muted">Opens a chat with +{wa.digits}. Press send in WhatsApp to deliver it.</p> : null}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>

                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button variant="secondary" disabled={!chosen.length || pending} onClick={copyLinks}>
                    <Link2 className="size-4" aria-hidden /> Copy {chosen.length > 1 ? "links" : "link"}
                  </Button>
                  <Button disabled={!ready || pending || !emailConfigured || emailable.length === 0} onClick={() => setConfirmEmail(true)} aria-expanded={confirmEmail}>
                    <Mail className="size-4" aria-hidden /> Send by email{bulk ? ` (${emailable.length})` : ""}
                  </Button>
                </div>
                {!emailConfigured ? (
                  <p className="text-xs text-muted">
                    Email sending is not set up yet. <Link href="/admin/marketing/emails/settings" className="text-brand-700 hover:underline">Email settings</Link>
                  </p>
                ) : emailable.length === 0 ? (
                  <p className="text-xs text-muted">None of the selected candidates has an email address (or all are marked do not contact).</p>
                ) : null}
                {confirmEmail ? (
                  <div role="group" aria-label="Confirm email" className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm">
                    <p>
                      Send “{previewSubject}” to {emailable.length} candidate{emailable.length === 1 ? "" : "s"}
                      {candidates.length > emailable.length ? ` (${candidates.length - emailable.length} skipped: no email address or do not contact)` : ""}? Each gets their own copy with their name filled in.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setConfirmEmail(false)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => record("email", candidates.filter((c) => !c.do_not_contact).map((c) => c.id), () => setConfirmEmail(false))}
                      >
                        {pending ? "Sending…" : `Send ${emailable.length === 1 ? "email" : `${emailable.length} emails`}`}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
            <p className="text-xs text-muted">
              Copying or opening WhatsApp is recorded as “not confirmed”: only you know whether you pressed send. Emails are marked sent only when the email provider accepts them.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CandidatePicker({ selectedIds, onAdd }: { selectedIds: string[]; onAdd: (c: ShareCandidate) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShareCandidate[] | null>(null);
  const [pending, startTransition] = useTransition();

  const search = () => {
    if (q.trim().length < 2) return setResults([]);
    startTransition(async () => setResults(await searchShareCandidates(q)));
  };

  return (
    <div className="grid gap-2">
      <form
        role="search"
        aria-label="Find candidates"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" aria-label="Name, email or phone" placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" maxLength={100} />
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Searching…" : "Find"}
        </Button>
      </form>
      {results ? (
        results.length === 0 ? (
          <p className="text-xs text-muted">{q.trim().length < 2 ? "Type at least 2 characters." : "No matching candidates you can see."}</p>
        ) : (
          <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-line p-1" aria-label="Search results">
            {results.map((c) => {
              const added = selectedIds.includes(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-canvas">
                  <span className="min-w-0">
                    <span className="font-medium">{c.full_name}</span>
                    <span className="block truncate text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Button size="xs" variant={added ? "ghost" : "secondary"} disabled={added} onClick={() => onAdd(c)}>
                    {added ? <Check className="size-3.5" aria-hidden /> : <UserPlus className="size-3.5" aria-hidden />}
                    {added ? "Added" : "Add"}
                    <span className="sr-only"> {c.full_name}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}
