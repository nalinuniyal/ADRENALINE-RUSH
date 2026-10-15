"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Check, Copy, KeyRound, Link2, MailPlus, MessageCircle, PauseCircle, PlayCircle, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import {
  changeMemberRole,
  inviteTeamMember,
  removeMember,
  resendInvitation,
  revokeInvitation,
  setMemberPermission,
  setMemberStatus,
  type InviteLinkResult,
  type TeamActionResult,
} from "@/app/actions/team";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, describedBy, Field, Input, Select } from "@/components/ui/field";
import { IconTile } from "@/components/ui/icon-tile";
import Link from "next/link";
import { roleLabel, type MemberRole } from "@/lib/auth/permissions";
import { encodeRoleChoice } from "@/lib/roles/matrix";
import { formatDate } from "@/lib/format";
import {
  INVITE_TTL_DAYS,
  isLastActiveOwner,
  memberLockReason,
  roleSwitchedOn,
  type InviteStatus,
  type MemberStatus,
} from "@/lib/team/rules";
import { inviteSchema } from "@/lib/validation/team";

export type MemberRow = {
  id: string;
  userId: string;
  /** Base role (a custom role's base, or the built-in role). */
  role: MemberRole;
  customRoleId: string | null;
  customRoleName: string | null;
  /** What the role grants before this member's own exceptions. */
  rolePermissions: string[];
  status: MemberStatus;
  name: string;
  email: string;
  since: string;
};
/** A choice in the role pickers: "staff" or "custom:<id>". */
export type RoleOption = { value: string; label: string; baseRole: MemberRole; description: string; custom?: boolean; disabledReason?: string };
export type InviteRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: MemberRole;
  customRoleName: string | null;
  status: InviteStatus;
  expiresAt: string;
  emailStatus: "sent" | "failed" | "not_sent" | null;
  lastSentAt: string | null;
};

type Switches = { staffEnabled: boolean; instructorsEnabled: boolean };
type Actor = { userId: string; role: MemberRole; permissions: string[] };

export function TeamManager({
  actor,
  members,
  invites,
  switches,
  emailConfigured,
  timezone,
  inviteRoles,
  memberRoles,
  canManageRoles,
  catalog,
  overrides,
  settingsLink,
}: {
  actor: Actor;
  members: MemberRow[];
  invites: InviteRow[];
  switches: Switches;
  emailConfigured: boolean;
  timezone: string;
  inviteRoles: RoleOption[];
  memberRoles: RoleOption[];
  canManageRoles: boolean;
  catalog: { key: string; description: string }[];
  overrides: Record<string, Record<string, boolean>>;
  settingsLink: ReactNode;
}) {
  const [linkResult, setLinkResult] = useState<InviteLinkResult>();
  const [notice, setNotice] = useState<TeamActionResult>();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<TeamActionResult>) =>
    startTransition(async () => {
      const res = await fn();
      setNotice(res.ok && !res.message ? undefined : res);
    });

  const runLink = (fn: () => Promise<InviteLinkResult>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setLinkResult(res);
        setNotice(undefined);
      } else setNotice(res);
    });

  const off = [!switches.staffEnabled ? "Staff / Counselor" : null, !switches.instructorsEnabled ? "Instructor" : null].filter(Boolean);

  return (
    // minmax(0,1fr): the wide invitations table scrolls inside its card instead of widening the page on phones.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {off.length ? (
        <Alert tone="warning" title={`${off.join(" and ")} sign-in is switched off`}>
          People with {off.length > 1 ? "these roles" : "this role"} can accept an invitation but cannot open the dashboard until you switch the role on in {settingsLink}.
        </Alert>
      ) : null}

      <div aria-live="polite">{notice?.message ? <Alert tone={notice.ok ? "success" : "danger"}>{notice.message}</Alert> : null}</div>
      {linkResult?.link ? <InviteLinkPanel result={linkResult} onClose={() => setLinkResult(undefined)} /> : null}

      <InviteCard roles={inviteRoles} canManageRoles={canManageRoles} emailConfigured={emailConfigured} switches={switches} onDone={setLinkResult} />

      {invites.length ? (
        <Card>
          <CardHeader icon={<IconTile icon={MailPlus} color="orange" size="sm" />}>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Each link works once. “New link” replaces the old link (the old one stops working) and gives another {INVITE_TTL_DAYS} days.</CardDescription>
          </CardHeader>
          <CardContent className="relative overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Invited</th>
                  <th scope="col" className="px-5 py-3 font-medium">Role</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const locked = actor.role !== "owner" && i.role === "admin";
                  return (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <p className="font-medium">{i.name}</p>
                        <p className="text-xs text-muted">{i.email}</p>
                      </td>
                      <td className="px-5 py-3">{roleLabel(i.role, i.customRoleName)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {i.status === "expired" ? <Badge tone="warning">Expired</Badge> : <Badge tone="brand">Pending</Badge>}
                          {i.emailStatus === "sent" ? <Badge tone="success">Emailed</Badge> : i.emailStatus === "failed" ? <Badge tone="danger">Email failed</Badge> : null}
                        </div>
                        <p className="mt-1 text-xs text-muted">{i.status === "expired" ? "Expired" : "Expires"} {formatDate(i.expiresAt, timezone)}</p>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="xs" variant="secondary" disabled={pending || locked} onClick={() => runLink(() => resendInvitation({ id: i.id }))} aria-label={`New link for ${i.name}`}>
                            <RefreshCw className="size-3.5" aria-hidden /> New link
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-danger-700 hover:bg-danger-50"
                            disabled={pending || locked}
                            onClick={() => {
                              if (window.confirm(`Cancel the invitation for ${i.name}? The link will stop working.`)) run(() => revokeInvitation({ id: i.id }));
                            }}
                            aria-label={`Cancel invitation for ${i.name}`}
                          >
                            <X className="size-3.5" aria-hidden /> Cancel
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader icon={<IconTile icon={UserPlus} color="indigo" size="sm" />}>
          <CardTitle>Members</CardTitle>
          <CardDescription>Suspend someone to switch their access off without losing their history; remove them when they leave for good.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <MemberItem
                key={`${m.id}-${m.role}-${m.customRoleId}-${m.status}`}
                member={m}
                members={members}
                actor={actor}
                switches={switches}
                pending={pending}
                run={run}
                timezone={timezone}
                roles={memberRoles}
                catalog={catalog}
                overrides={overrides[m.id] ?? {}}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------

type InviteFormInput = z.input<typeof inviteSchema>;

function InviteCard({
  roles,
  canManageRoles,
  emailConfigured,
  switches,
  onDone,
}: {
  roles: RoleOption[];
  canManageRoles: boolean;
  emailConfigured: boolean;
  switches: Switches;
  onDone: (r: InviteLinkResult) => void;
}) {
  const [serverError, setServerError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<InviteFormInput, unknown, z.output<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { fullName: "", email: "", role: "staff", phone: "", sendEmail: emailConfigured },
  });
  const role = useWatch({ control, name: "role" });
  const option = roles.find((r) => r.value === role);

  const onSubmit = () => {
    setServerError(undefined);
    startTransition(async () => {
      const res = await inviteTeamMember(getValues());
      if (res.ok) {
        reset({ fullName: "", email: "", role: getValues("role"), phone: "", sendEmail: emailConfigured });
        onDone(res);
        return;
      }
      if (res.message) setServerError(res.message);
      for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
        if (messages?.[0]) setError(field as keyof InviteFormInput, { message: messages[0] });
      }
    });
  };

  const err = (k: keyof InviteFormInput) => errors[k]?.message as string | undefined;

  return (
    <Card>
      <CardHeader icon={<IconTile icon={MailPlus} color="blue" size="sm" />}>
        <CardTitle>Invite someone</CardTitle>
        <CardDescription>They get a private link to choose their password. The link works once and expires in {INVITE_TTL_DAYS} days.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
          {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="inv-name" label="Full name" required error={err("fullName")}>
              <Input id="inv-name" autoComplete="off" aria-invalid={Boolean(err("fullName"))} aria-describedby={describedBy("inv-name", err("fullName"))} {...register("fullName")} />
            </Field>
            <Field id="inv-email" label="Email" required error={err("email")}>
              <Input id="inv-email" type="email" autoComplete="off" aria-invalid={Boolean(err("email"))} aria-describedby={describedBy("inv-email", err("email"))} {...register("email")} />
            </Field>
            <Field
              id="inv-role"
              label="Role"
              required
              error={err("role")}
              hint={
                <>
                  {option ? option.disabledReason ?? option.description : ""}
                  {option && !roleSwitchedOn(option.baseRole, switches) ? " This role is switched off right now." : ""}
                  {canManageRoles ? (
                    <>
                      {" "}
                      <Link href="/admin/settings/roles" className="font-medium text-brand-600 hover:underline">
                        Roles &amp; access
                      </Link>
                    </>
                  ) : null}
                </>
              }
            >
              <Select id="inv-role" aria-describedby={describedBy("inv-role", err("role"), true)} {...register("role")}>
                <RoleOptions roles={roles} />
              </Select>
            </Field>
            <Field id="inv-phone" label="WhatsApp number (optional)" error={err("phone")} hint="With country code. Opens their chat directly when you share the link.">
              <Input id="inv-phone" type="tel" autoComplete="off" placeholder="+91 98765 43210" aria-invalid={Boolean(err("phone"))} aria-describedby={describedBy("inv-phone", err("phone"), true)} {...register("phone")} />
            </Field>
          </div>
          <Checkbox
            id="inv-send-email"
            label="Also send the invitation by email"
            description={emailConfigured ? "Uses the “Team invitation” template in Marketing → Emails." : "No email provider is set up yet, so you will share the link yourself (copy or WhatsApp)."}
            disabled={!emailConfigured}
            {...register("sendEmail")}
          />
          <div>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              <UserPlus className="size-4" aria-hidden /> {pending ? "Creating invitation…" : "Create invitation"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function InviteLinkPanel({ result, onClose }: { result: InviteLinkResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.link ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section aria-label="Invitation link" className="grid gap-3 rounded-[var(--radius-card)] border border-brand-200 bg-brand-50 p-4 shadow-card animate-scale-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-semibold text-brand-800">
            <Link2 className="size-4" aria-hidden /> Invitation link{result.inviteeName ? ` for ${result.inviteeName}` : ""}
          </p>
          <p className="mt-1 text-sm text-brand-800">{result.message}</p>
        </div>
        <Button size="icon" variant="ghost" className="size-8" onClick={onClose} aria-label="Close">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <label htmlFor="invite-link" className="sr-only">
        Invitation link
      </label>
      <Input id="invite-link" readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {copied ? "Copied" : "Copy invite link"}
        </Button>
        {result.whatsappUrl ? (
          <a href={result.whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-sm font-medium text-success-700 hover:bg-success-50">
            <MessageCircle className="size-4" aria-hidden /> Share on WhatsApp
          </a>
        ) : null}
      </div>
      <p className="text-xs text-brand-800">For security the full link is shown only now. If it gets lost, use “New link”.</p>
    </section>
  );
}

// -----------------------------------------------------------------------------

function MemberItem({
  member: m,
  members,
  actor,
  switches,
  pending,
  run,
  timezone,
  roles: roleOptions,
  catalog,
  overrides,
}: {
  member: MemberRow;
  members: MemberRow[];
  actor: Actor;
  switches: Switches;
  pending: boolean;
  run: (fn: () => Promise<TeamActionResult>) => void;
  timezone: string;
  roles: RoleOption[];
  catalog: { key: string; description: string }[];
  overrides: Record<string, boolean>;
}) {
  const [showPerms, setShowPerms] = useState(false);
  const lock = memberLockReason(actor, m);
  const lastOwner = isLastActiveOwner(members, m);
  const isSelf = m.userId === actor.userId;
  const current = encodeRoleChoice(m.role, m.customRoleId);
  const label = roleLabel(m.role, m.customRoleName);
  const choices = roleOptions.some((r) => r.value === current) ? roleOptions : [{ value: current, label, baseRole: m.role, description: "" }, ...roleOptions];
  const roleOff = !roleSwitchedOn(m.role, switches);
  const name = m.name || m.email;
  const overrideCount = Object.keys(overrides).length;

  return (
    <li className="grid gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {name} {isSelf ? <span className="text-xs font-normal text-muted">(you)</span> : null}
          </p>
          <p className="truncate text-xs text-muted">
            {m.email} · since {formatDate(m.since, timezone)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {m.status === "active" ? <Badge tone="success">Active</Badge> : m.status === "suspended" ? <Badge tone="danger">Suspended</Badge> : <Badge>Invited</Badge>}
          {roleOff ? <Badge tone="warning" title="Switched off in Business profile">Role switched off</Badge> : null}
          {overrideCount ? <Badge tone="violet">{overrideCount} custom permission{overrideCount > 1 ? "s" : ""}</Badge> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`role-${m.id}`} className="sr-only">
          Role for {name}
        </label>
        {lock || lastOwner ? (
          <span className="text-sm">
            {label}
            <span className="ml-2 text-xs text-muted">{lock ?? "The last active owner cannot be changed."}</span>
          </span>
        ) : (
          <>
            <Select
              id={`role-${m.id}`}
              className="h-8 w-auto py-1"
              defaultValue={current}
              disabled={pending}
              onChange={(e) => {
                const next = e.target.value;
                const nextLabel = choices.find((r) => r.value === next)?.label ?? next;
                const warn = next === "owner" ? `Make ${name} an owner? Owners can do everything, including removing you.` : `Change ${name}'s role to ${nextLabel}?`;
                if (window.confirm(warn)) run(() => changeMemberRole({ id: m.id, role: next }));
                else e.target.value = current;
              }}
            >
              <RoleOptions roles={choices} />
            </Select>
            {m.status === "suspended" ? (
              <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => setMemberStatus({ id: m.id, status: "active" }))}>
                <PlayCircle className="size-3.5" aria-hidden /> Reactivate
              </Button>
            ) : (
              <Button
                size="xs"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Suspend ${name}? They will not be able to open the dashboard until you reactivate them.`)) run(() => setMemberStatus({ id: m.id, status: "suspended" }));
                }}
              >
                <PauseCircle className="size-3.5" aria-hidden /> Suspend
              </Button>
            )}
            {m.role !== "owner" ? (
              <Button size="xs" variant="ghost" disabled={pending} onClick={() => setShowPerms((v) => !v)} aria-expanded={showPerms} aria-controls={`perms-${m.id}`}>
                <KeyRound className="size-3.5" aria-hidden /> Permissions
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              className="text-danger-700 hover:bg-danger-50"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Remove ${name} from the team? Their login will no longer open this dashboard. Records they created stay.`)) run(() => removeMember({ id: m.id }));
              }}
            >
              <Trash2 className="size-3.5" aria-hidden /> Remove
            </Button>
          </>
        )}
      </div>

      {showPerms && !lock && m.role !== "owner" ? (
        <PermissionEditor id={`perms-${m.id}`} membershipId={m.id} roleLabel={label} roleDefaults={m.rolePermissions} catalog={catalog} overrides={overrides} actor={actor} pending={pending} run={run} />
      ) : null}
    </li>
  );
}

function PermissionEditor({
  id,
  membershipId,
  roleLabel,
  roleDefaults,
  catalog,
  overrides,
  actor,
  pending,
  run,
}: {
  id: string;
  membershipId: string;
  roleLabel: string;
  roleDefaults: string[];
  catalog: { key: string; description: string }[];
  overrides: Record<string, boolean>;
  actor: Actor;
  pending: boolean;
  run: (fn: () => Promise<TeamActionResult>) => void;
}) {
  return (
    <div id={id} className="rounded-lg border border-line bg-canvas p-3">
      <p className="mb-3 text-xs text-muted">
        Start from the {roleLabel} defaults and allow or block individual permissions. You can only allow permissions you have yourself.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {catalog.map((p) => {
          const def = roleDefaults.includes(p.key);
          const value = p.key in overrides ? (overrides[p.key] ? "allow" : "deny") : "default";
          const cannotGrant = !actor.permissions.includes(p.key) && actor.role !== "owner";
          return (
            <li key={p.key} className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2">
              <label htmlFor={`${id}-${p.key}`} className="min-w-0 text-sm">
                <span className="block truncate">{p.description}</span>
                <span className="block text-xs text-muted">{p.key}</span>
              </label>
              <Select
                id={`${id}-${p.key}`}
                className="h-8 w-36 shrink-0 py-1 text-xs"
                value={value}
                disabled={pending}
                onChange={(e) => run(() => setMemberPermission({ membershipId, permission: p.key, value: e.target.value }))}
              >
                <option value="default">Default ({def ? "on" : "off"})</option>
                <option value="allow" disabled={cannotGrant}>
                  Allow
                </option>
                <option value="deny">Block</option>
              </Select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Built-in roles first, then custom roles; roles holding access the actor lacks are shown but disabled. */
function RoleOptions({ roles }: { roles: RoleOption[] }) {
  const builtin = roles.filter((r) => !r.custom);
  const custom = roles.filter((r) => r.custom);
  const opt = (r: RoleOption) => (
    <option key={r.value} value={r.value} disabled={Boolean(r.disabledReason)} title={r.disabledReason}>
      {r.label}
      {r.disabledReason ? " (not available to you)" : ""}
    </option>
  );
  if (!custom.length) return <>{builtin.map(opt)}</>;
  return (
    <>
      <optgroup label="Built-in roles">{builtin.map(opt)}</optgroup>
      <optgroup label="Custom roles">{custom.map(opt)}</optgroup>
    </>
  );
}
