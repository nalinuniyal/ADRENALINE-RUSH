"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { createLeadStatus, deleteLeadStatus, moveLeadStatus, updateLeadStatus } from "@/app/actions/lead-statuses";
import type { ActionResult } from "@/app/actions/candidates";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { LEAD_STATUS_COLOR_LABELS, LEAD_STATUS_COLORS, type LeadStatusColor } from "@/lib/validation/candidates";

export type LeadStatusRow = { id: string; key: string; label: string; color: LeadStatusColor; is_closed: boolean; is_won: boolean };

type Draft = { label: string; color: LeadStatusColor; isClosed: boolean; isWon: boolean };

const toDraft = (s: LeadStatusRow): Draft => ({ label: s.label, color: s.color, isClosed: s.is_closed, isWon: s.is_won });

/** Rename, recolour, reorder and add lead statuses. Used statuses cannot be deleted (enforced in the database). */
export function LeadStatusSettings({ statuses }: { statuses: LeadStatusRow[] }) {
  const [result, setResult] = useState<ActionResult>();
  const [pending, startTransition] = useTransition();
  const [newDraft, setNewDraft] = useState<Draft>({ label: "", color: "neutral", isClosed: false, isWon: false });

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      setResult(res.ok && !res.message ? undefined : { ...res, message: res.message ?? Object.values(res.fieldErrors ?? {})[0]?.[0] });
      if (res.ok) after?.();
    });

  return (
    <div className="grid gap-4">
      <div aria-live="polite">{result?.message ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}</div>
      <ol className="grid gap-2">
        {statuses.map((s, i) => (
          <StatusRow
            key={`${s.id}-${s.label}-${s.color}-${s.is_closed}-${s.is_won}`}
            status={s}
            first={i === 0}
            last={i === statuses.length - 1}
            pending={pending}
            onSave={(d) => run(() => updateLeadStatus({ id: s.id, ...d }))}
            onMove={(direction) => run(() => moveLeadStatus({ id: s.id, direction }))}
            onDelete={() => {
              if (window.confirm(`Delete the “${s.label}” status? This only works if no candidate uses it.`)) run(() => deleteLeadStatus({ id: s.id }));
            }}
          />
        ))}
      </ol>

      <form
        className="grid gap-3 rounded-lg border border-dashed border-line-strong p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createLeadStatus(newDraft), () => setNewDraft({ label: "", color: "neutral", isClosed: false, isWon: false }));
        }}
      >
        <div className="grid gap-1">
          <label htmlFor="ls-new-label" className="text-xs font-medium text-[#444]">New status</label>
          <Input id="ls-new-label" maxLength={60} value={newDraft.label} onChange={(e) => setNewDraft({ ...newDraft, label: e.target.value })} placeholder="e.g. Callback scheduled" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="ls-new-color" className="text-xs font-medium text-[#444]">Colour</label>
          <Select id="ls-new-color" value={newDraft.color} onChange={(e) => setNewDraft({ ...newDraft, color: e.target.value as LeadStatusColor })}>
            {LEAD_STATUS_COLORS.map((c) => (
              <option key={c} value={c}>{LEAD_STATUS_COLOR_LABELS[c]}</option>
            ))}
          </Select>
        </div>
        <Button type="submit" size="md" disabled={pending || newDraft.label.trim() === ""}>
          <Plus className="size-4" aria-hidden /> Add status
        </Button>
      </form>
    </div>
  );
}

function StatusRow({
  status,
  first,
  last,
  pending,
  onSave,
  onMove,
  onDelete,
}: {
  status: LeadStatusRow;
  first: boolean;
  last: boolean;
  pending: boolean;
  onSave: (d: Draft) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(toDraft(status));
  const initial = toDraft(status);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const id = `ls-${status.id}`;

  return (
    <li className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[auto_1fr_9rem_auto] sm:items-center">
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="size-8" onClick={() => onMove("up")} disabled={pending || first} aria-label={`Move ${status.label} up`}>
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => onMove("down")} disabled={pending || last} aria-label={`Move ${status.label} down`}>
          <ArrowDown className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={`${id}-label`} className="sr-only">Label for {status.label}</label>
        <Input id={`${id}-label`} maxLength={60} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <Badge tone={draft.color} className="hidden sm:inline-flex">{draft.label || "—"}</Badge>
      </div>
      <div>
        <label htmlFor={`${id}-color`} className="sr-only">Colour for {status.label}</label>
        <Select id={`${id}-color`} value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value as LeadStatusColor })}>
          {LEAD_STATUS_COLORS.map((c) => (
            <option key={c} value={c}>{LEAD_STATUS_COLOR_LABELS[c]}</option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" className="size-4 accent-brand-600" checked={draft.isClosed} onChange={(e) => setDraft({ ...draft, isClosed: e.target.checked, isWon: e.target.checked && draft.isWon })} />
          Closed
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" className="size-4 accent-brand-600" checked={draft.isWon} onChange={(e) => setDraft({ ...draft, isWon: e.target.checked, isClosed: e.target.checked || draft.isClosed })} />
          Won
        </label>
        <Button size="xs" onClick={() => onSave(draft)} disabled={pending || !dirty || draft.label.trim() === ""}>Save</Button>
        {status.key !== "new" ? (
          <Button size="icon" variant="ghost" className="size-8 text-danger-700 hover:bg-danger-50" onClick={onDelete} disabled={pending} aria-label={`Delete ${status.label}`}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
