"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AlertTriangle, Crown, Lock, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { createCustomRole, deleteCustomRole, resetBuiltinRole, saveBuiltinRole, updateCustomRole, type RoleActionResult } from "@/app/actions/roles";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { IconTile } from "@/components/ui/icon-tile";
import { ROLE_LABELS, type MemberRole, type Permission } from "@/lib/auth/permissions";
import {
  BASE_ROLE_SCOPE,
  beyondActor,
  candidateScope,
  groupPermissions,
  moduleSummary,
  PERMISSION_INFO,
  permissionDiff,
  sensitiveIn,
  setModule,
  togglePermission,
  withCandidateScope,
  type BuiltinEditableRole,
  type CandidateScope,
  type GroupedModule,
} from "@/lib/roles/matrix";
import { ROLE_DESCRIPTIONS } from "@/lib/team/rules";

type Actor = { role: MemberRole; permissions: string[] };
type BuiltinRow = { role: BuiltinEditableRole; permissions: string[]; defaults: string[]; changed: boolean; members: number };
type CustomRow = { id: string; name: string; description: string | null; baseRole: BuiltinEditableRole; permissions: string[]; members: number; invitations: number };

/** Starting points for common roles; everything stays editable. */
const TEMPLATES: { name: string; description: string; baseRole: BuiltinEditableRole; permissions: Permission[] }[] = [
  {
    name: "Accounts",
    description: "Fees, payments, receipts and expenses, plus read-only candidate details so fee lists show student names.",
    baseRole: "staff",
    permissions: ["dashboard.view", "candidates.view_all", "finance.view", "finance.manage"],
  },
  {
    name: "Counsellor - read only",
    description: "Looks up their assigned candidates, courses and batches but cannot change anything.",
    baseRole: "staff",
    permissions: ["dashboard.view", "courses.view", "candidates.view_assigned", "resources.view", "batches.view", "sessions.view"],
  },
  {
    name: "Senior instructor",
    description: "Teaches their batches, schedules classes and shares demos.",
    baseRole: "instructor",
    permissions: ["dashboard.view", "courses.view", "resources.view", "resources.manage", "resources.share", "batches.view", "sessions.view", "sessions.manage", "attendance.record"],
  },
];

type Editing = { kind: "builtin"; role: BuiltinEditableRole } | { kind: "custom"; id: string } | { kind: "new"; template?: (typeof TEMPLATES)[number] } | null;

export function RolesManager({ actor, ownerCount, builtins, customRoles }: { actor: Actor; ownerCount: number; builtins: BuiltinRow[]; customRoles: CustomRow[] }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<RoleActionResult>();
  const [pending, startTransition] = useTransition();
  const isOwner = actor.role === "owner";

  const done = (res: RoleActionResult) => {
    setNotice(res);
    if (res.ok) setEditing(null);
  };

  const remove = (r: CustomRow) => {
    if (!window.confirm(`Delete the role “${r.name}”? This cannot be undone.`)) return;
    startTransition(async () => setNotice(await deleteCustomRole({ id: r.id })));
  };

  return (
    <div className="grid gap-4">
      <Alert tone="info" title="How access works">
        Each team member has one role. The <strong>owner</strong> can always do everything. Change what the built-in roles can do for your business, or create your own roles
        (for example “Accounts”). For a one-off exception for a single person, use <strong>Permissions</strong> next to their name in Team. Nobody except the owner can
        give access they do not have themselves.
      </Alert>

      <div aria-live="polite">{notice?.message ? <Alert tone={notice.ok ? "success" : "danger"}>{notice.message}</Alert> : null}</div>

      <Card>
        <CardHeader icon={<IconTile icon={ShieldCheck} color="violet" size="sm" />}>
          <CardTitle>Built-in roles</CardTitle>
          <CardDescription>Changes apply to everyone with the role, straight away. “Reset to default” brings back the original permissions.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-line">
            <li className="flex flex-wrap items-center gap-3 px-5 py-4">
              <Crown className="size-4 text-warning-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {ROLE_LABELS.owner} <Badge tone="inverse">Everything</Badge>
                </p>
                <p className="text-xs text-muted">{ROLE_DESCRIPTIONS.owner} The owner role cannot be changed.</p>
              </div>
              <MemberCount n={ownerCount} />
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Lock className="size-3.5" aria-hidden /> Locked
              </span>
            </li>
            {builtins.map((b) => {
              const locked = b.role === "admin" && !isOwner;
              const open = editing?.kind === "builtin" && editing.role === b.role;
              return (
                <li key={b.role} className="grid gap-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {ROLE_LABELS[b.role]} {b.changed ? <Badge tone="violet">Changed for your business</Badge> : null}
                      </p>
                      <p className="text-xs text-muted">{ROLE_DESCRIPTIONS[b.role]}</p>
                      <ModuleList perms={b.permissions} />
                    </div>
                    <MemberCount n={b.members} />
                    {locked ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Lock className="size-3.5" aria-hidden /> Owner only
                      </span>
                    ) : (
                      <Button size="xs" variant="secondary" disabled={pending} onClick={() => setEditing(open ? null : { kind: "builtin", role: b.role })} aria-expanded={open}>
                        <Pencil className="size-3.5" aria-hidden /> {open ? "Close" : "Edit permissions"}
                      </Button>
                    )}
                  </div>
                  {open ? <BuiltinEditor key={b.role + b.permissions.join()} row={b} actor={actor} onDone={done} onCancel={() => setEditing(null)} /> : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          icon={<IconTile icon={UsersRound} color="indigo" size="sm" />}
          actions={
            editing?.kind === "new" ? null : (
              <Button size="sm" onClick={() => setEditing({ kind: "new" })} disabled={pending}>
                <Plus className="size-4" aria-hidden /> New role
              </Button>
            )
          }
        >
          <CardTitle>Custom roles</CardTitle>
          <CardDescription>Your own roles, such as “Accounts” or “Senior instructor”, with exactly the permissions you pick.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {editing?.kind === "new" ? (
            <div className="grid gap-3">
              {!editing.template ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">Start from:</span>
                  {TEMPLATES.map((t) => (
                    <Button key={t.name} size="xs" variant="secondary" onClick={() => setEditing({ kind: "new", template: t })}>
                      {t.name}
                    </Button>
                  ))}
                  <span className="text-muted">or a blank role below.</span>
                </div>
              ) : null}
              <CustomEditor key={editing.template?.name ?? "blank"} actor={actor} template={editing.template} onDone={done} onCancel={() => setEditing(null)} />
            </div>
          ) : null}

          {customRoles.length === 0 && editing?.kind !== "new" ? (
            <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
              No custom roles yet. Choose <strong>New role</strong> to create one, for example “Accounts” for someone who only handles payments.
            </p>
          ) : null}

          {customRoles.length ? (
            <ul className="divide-y divide-line rounded-md border border-line">
              {customRoles.map((r) => {
                const locked = r.baseRole === "admin" && !isOwner;
                const open = editing?.kind === "custom" && editing.id === r.id;
                const inUse = r.members > 0 || r.invitations > 0;
                return (
                  <li key={r.id} className="grid gap-3 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          <span>{r.name}</span> <Badge tone="neutral">Based on {ROLE_LABELS[r.baseRole]}</Badge>
                        </p>
                        {r.description ? <p className="text-xs text-muted">{r.description}</p> : null}
                        <ModuleList perms={r.permissions} />
                      </div>
                      <MemberCount n={r.members} />
                      {locked ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <Lock className="size-3.5" aria-hidden /> Owner only
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button size="xs" variant="secondary" disabled={pending} onClick={() => setEditing(open ? null : { kind: "custom", id: r.id })} aria-expanded={open} aria-label={`Edit ${r.name}`}>
                            <Pencil className="size-3.5" aria-hidden /> {open ? "Close" : "Edit"}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-danger-700 hover:bg-danger-50"
                            disabled={pending || inUse}
                            title={inUse ? "Give the people with this role another role (and cancel its open invitations) first." : undefined}
                            onClick={() => remove(r)}
                            aria-label={`Delete ${r.name}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden /> Delete
                          </Button>
                        </div>
                      )}
                    </div>
                    {inUse && !locked ? (
                      <p className="text-xs text-muted">
                        To delete it, first{" "}
                        {[r.members ? `give the ${r.members} member(s) with it another role in Team` : null, r.invitations ? `cancel its ${r.invitations} open invitation(s) in Team` : null]
                          .filter(Boolean)
                          .join(" and ")}
                        .
                      </p>
                    ) : null}
                    {open ? <CustomEditor key={r.id + r.permissions.join()} actor={actor} existing={r} onDone={done} onCancel={() => setEditing(null)} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MemberCount({ n }: { n: number }) {
  return <span className="text-xs whitespace-nowrap text-muted">{n === 1 ? "1 member" : `${n} members`}</span>;
}

function ModuleList({ perms }: { perms: readonly string[] }) {
  const mods = moduleSummary(perms);
  return <p className="mt-1 text-xs text-fg">{mods.length ? `Can open: ${mods.join(", ")}` : "No access to any module"}</p>;
}

// -----------------------------------------------------------------------------
// Editors
// -----------------------------------------------------------------------------

function BuiltinEditor({ row, actor, onDone, onCancel }: { row: BuiltinRow; actor: Actor; onDone: (r: RoleActionResult) => void; onCancel: () => void }) {
  const [perms, setPerms] = useState<string[]>(row.permissions);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const diff = permissionDiff(row.permissions, perms);
  const fromDefault = permissionDiff(row.defaults, row.permissions);

  const save = () =>
    startTransition(async () => {
      const res = await saveBuiltinRole({ role: row.role, permissions: perms });
      if (res.ok) onDone(res);
      else setError(res.message);
    });
  const reset = () => {
    if (!window.confirm(`Reset ${ROLE_LABELS[row.role]} to the default permissions?`)) return;
    startTransition(async () => {
      const res = await resetBuiltinRole({ role: row.role });
      if (res.ok) onDone(res);
      else setError(res.message);
    });
  };

  return (
    <div className="grid gap-3 rounded-lg border border-line bg-canvas p-3 sm:p-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {row.changed ? (
        <p className="text-xs text-muted">
          Changed from the default:
          {fromDefault.added.length ? ` added ${fromDefault.added.map((p) => PERMISSION_INFO[p].label).join(", ")}.` : ""}
          {fromDefault.removed.length ? ` removed ${fromDefault.removed.map((p) => PERMISSION_INFO[p].label).join(", ")}.` : ""}
        </p>
      ) : null}
      <PermissionMatrix perms={perms} onChange={setPerms} actor={actor} original={row.permissions} baseRole={row.role} idPrefix={`builtin-${row.role}`} />
      <SensitiveSummary perms={perms} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={pending || (!diff.added.length && !diff.removed.length)} aria-busy={pending}>
          {pending ? "Saving…" : `Save ${ROLE_LABELS[row.role]}`}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {row.changed ? (
          <Button variant="ghost" onClick={reset} disabled={pending}>
            <RotateCcw className="size-4" aria-hidden /> Reset to default
          </Button>
        ) : null}
        <ChangeCount added={diff.added.length} removed={diff.removed.length} />
      </div>
    </div>
  );
}

function CustomEditor({
  existing,
  template,
  actor,
  onDone,
  onCancel,
}: {
  existing?: CustomRow;
  template?: (typeof TEMPLATES)[number];
  actor: Actor;
  onDone: (r: RoleActionResult) => void;
  onCancel: () => void;
}) {
  const start = existing ?? template;
  const [name, setName] = useState(start?.name ?? "");
  const [description, setDescription] = useState(start?.description ?? "");
  const [baseRole, setBaseRole] = useState<BuiltinEditableRole>(start?.baseRole ?? "staff");
  const [perms, setPerms] = useState<string[]>(start ? [...start.permissions] : ["dashboard.view"]);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const uid = useId();

  const id = (s: string) => `${uid}-${s}`;
  const baseOptions: BuiltinEditableRole[] = actor.role === "owner" ? ["staff", "instructor", "admin"] : ["staff", "instructor"];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(undefined);
    startTransition(async () => {
      const res = existing
        ? await updateCustomRole({ id: existing.id, name, description, permissions: perms })
        : await createCustomRole({ name, description, baseRole, permissions: perms });
      if (res.ok) {
        onDone(res);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setMessage(res.message);
    });
  };
  const err = (k: string) => errors[k]?.[0];

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 rounded-lg border border-line bg-canvas p-3 sm:p-4" aria-label={existing ? `Edit ${existing.name}` : "New role"}>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("name")} label="Role name" required error={err("name")}>
          <Input
            autoFocus
            id={id("name")}
            value={name}
            maxLength={60}
            placeholder="e.g. Accounts"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(err("name"))}
            aria-describedby={describedBy(id("name"), err("name"))}
          />
        </Field>
        <Field
          id={id("base")}
          label="Based on"
          required
          error={err("baseRole")}
          hint={existing ? `${BASE_ROLE_SCOPE[baseRole]} The base cannot be changed later; create a new role instead.` : BASE_ROLE_SCOPE[baseRole]}
        >
          <Select id={id("base")} value={baseRole} disabled={Boolean(existing)} onChange={(e) => setBaseRole(e.target.value as BuiltinEditableRole)} aria-describedby={describedBy(id("base"), err("baseRole"), true)}>
            {baseOptions.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={id("desc")} label="Description (optional)" error={err("description")} className="sm:col-span-2" hint="Shown to you in Team and to the person on their invitation.">
          <Textarea
            id={id("desc")}
            value={description}
            maxLength={300}
            rows={2}
            className="min-h-0"
            onChange={(e) => setDescription(e.target.value)}
            aria-describedby={describedBy(id("desc"), err("description"), true)}
          />
        </Field>
      </div>
      <PermissionMatrix perms={perms} onChange={setPerms} actor={actor} original={existing?.permissions ?? []} baseRole={baseRole} idPrefix={id("p")} />
      {err("permissions") ? <Alert tone="danger">{err("permissions")}</Alert> : null}
      <SensitiveSummary perms={perms} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : existing ? "Save role" : "Create role"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        {existing ? <ChangeCount {...countDiff(existing.permissions, perms)} /> : null}
      </div>
    </form>
  );
}

function countDiff(before: readonly string[], after: readonly string[]) {
  const d = permissionDiff(before, after);
  return { added: d.added.length, removed: d.removed.length };
}

function ChangeCount({ added, removed }: { added: number; removed: number }) {
  if (!added && !removed) return null;
  return (
    <span className="text-xs text-muted">
      {added ? `${added} added` : ""}
      {added && removed ? ", " : ""}
      {removed ? `${removed} removed` : ""} (not saved yet)
    </span>
  );
}

function SensitiveSummary({ perms }: { perms: readonly string[] }) {
  const s = sensitiveIn(perms);
  const financeWithoutCandidates = perms.includes("finance.view") && candidateScope(perms) === "none";
  return (
    <>
      {financeWithoutCandidates ? (
        <Alert tone="info" title="Fee lists will look empty">
          Fees and payments are listed per student, and this role cannot see any candidates. Choose “All candidates” under Candidates (nothing else needed) so they can see whose
          fees they are handling. Expenses work either way.
        </Alert>
      ) : null}
      {s.length ? <SensitiveList perms={s} /> : null}
    </>
  );
}

function SensitiveList({ perms: s }: { perms: Permission[] }) {
  return (
    <Alert tone="warning" title="Sensitive access in this role">
      <ul className="list-disc pl-4">
        {s.map((p) => (
          <li key={p}>
            <strong>{PERMISSION_INFO[p].label}:</strong> {PERMISSION_INFO[p].sensitive}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

// -----------------------------------------------------------------------------
// The matrix
// -----------------------------------------------------------------------------

const SCOPE_NOTES: Partial<Record<string, Record<BuiltinEditableRole, string>>> = {
  batches: {
    admin: "Sees every batch.",
    staff: "Sees every batch.",
    instructor: "Sees only the batches they teach (unless they can create and edit batches).",
  },
  calendar: {
    admin: "Sees every class.",
    staff: "Sees every class.",
    instructor: "Sees only their own classes (unless they can schedule classes).",
  },
};

function PermissionMatrix({
  perms,
  onChange,
  actor,
  original,
  baseRole,
  idPrefix,
}: {
  perms: string[];
  onChange: (p: string[]) => void;
  actor: Actor;
  original: readonly string[];
  baseRole: BuiltinEditableRole;
  idPrefix: string;
}) {
  const groups = groupPermissions(perms);
  // Non-owners may keep what a role already has, but not add what they lack.
  const cannotAdd = (k: string) => beyondActor([k], actor).length > 0 && !original.includes(k);

  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-semibold">Permissions</legend>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((g) => (
          <ModuleCard key={g.id} group={g} perms={perms} onChange={onChange} cannotAdd={cannotAdd} scopeNote={SCOPE_NOTES[g.id]?.[baseRole]} idPrefix={idPrefix} />
        ))}
      </div>
    </fieldset>
  );
}

function ModuleCard({
  group: g,
  perms,
  onChange,
  cannotAdd,
  scopeNote,
  idPrefix,
}: {
  group: GroupedModule;
  perms: string[];
  onChange: (p: string[]) => void;
  cannotAdd: (k: string) => boolean;
  scopeNote?: string;
  idPrefix: string;
}) {
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = g.state === "some";
  }, [g.state]);
  const allId = `${idPrefix}-${g.id}-all`;
  const blockedInModule = g.items.some((i) => !i.on && cannotAdd(i.key));
  const isCandidates = g.id === "candidates";
  const scope = candidateScope(perms);
  const items = isCandidates ? g.items.filter((i) => i.key !== "candidates.view_all" && i.key !== "candidates.view_assigned") : g.items;

  return (
    <section className="rounded-md border border-line bg-surface" aria-labelledby={`${allId}-label`}>
      <div className="flex items-start gap-3 border-b border-line px-3 py-2">
        <input
          ref={allRef}
          id={allId}
          type="checkbox"
          className="mt-1 size-4 rounded border-line-strong accent-brand-600"
          checked={g.state === "all"}
          disabled={g.state !== "all" && blockedInModule}
          onChange={(e) => onChange(setModule(perms, g.id, e.target.checked))}
          aria-describedby={`${allId}-desc`}
        />
        <label htmlFor={allId} className="min-w-0 flex-1">
          <span id={`${allId}-label`} className="block text-sm font-semibold">
            {g.label}
          </span>
          <span id={`${allId}-desc`} className="block text-xs text-muted">
            {g.description} {g.state === "all" ? "All selected." : "Tick to select all."}
          </span>
        </label>
      </div>
      <div className="grid gap-2 px-3 py-2">
        {isCandidates ? (
          <div role="radiogroup" aria-label="Which candidates they see" className="grid gap-1">
            <p className="text-xs font-medium text-[#444]">Which candidates they see</p>
            {(
              [
                ["all", "All candidates", "candidates.view_all"],
                ["assigned", "Only candidates assigned to them", "candidates.view_assigned"],
                ["none", "None", null],
              ] as [CandidateScope, string, Permission | null][]
            ).map(([value, label, key]) => {
              const rid = `${idPrefix}-cand-${value}`;
              const blocked = key ? scope !== value && cannotAdd(key) : false;
              return (
                <div key={value} className="flex items-center gap-2 text-sm">
                  <input
                    id={rid}
                    type="radio"
                    name={`${idPrefix}-cand-scope`}
                    className="size-4 accent-brand-600"
                    checked={scope === value}
                    disabled={blocked}
                    onChange={() => onChange(withCandidateScope(perms, value))}
                  />
                  <label htmlFor={rid}>
                    {label}
                    {blocked ? <span className="ml-1 text-xs text-muted">(you don’t have this)</span> : null}
                  </label>
                </div>
              );
            })}
          </div>
        ) : null}
        {items.map((i) => {
          const pid = `${idPrefix}-${i.key}`;
          const blocked = !i.on && cannotAdd(i.key);
          return (
            <div key={i.key} className="flex items-start gap-2">
              <input
                id={pid}
                type="checkbox"
                className="mt-0.5 size-4 rounded border-line-strong accent-brand-600"
                checked={i.on}
                disabled={blocked}
                onChange={(e) => onChange(togglePermission(perms, i.key, e.target.checked))}
                aria-describedby={`${pid}-desc`}
              />
              <label htmlFor={pid} className="min-w-0 text-sm">
                <span className="font-medium">{i.label}</span>
                {i.sensitive ? (
                  <Badge tone="warning" className="ml-1.5 align-middle" title={i.sensitive}>
                    <AlertTriangle className="size-3" aria-hidden /> Sensitive
                  </Badge>
                ) : null}
                <span id={`${pid}-desc`} className="block text-xs text-muted">
                  {i.description}
                  {blocked ? " You don’t have this permission yourself, so you can’t give it." : ""}
                </span>
              </label>
            </div>
          );
        })}
        {scopeNote ? <p className="text-xs text-muted italic">{scopeNote} This comes from the role it is based on.</p> : null}
      </div>
    </section>
  );
}
