import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckCircle2, CircleDashed, Server, Users } from "lucide-react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { requireAccess } from "@/lib/auth/session";
import { emailProviderStatus } from "@/lib/email/config";
import { publicEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmailsHeader, EmailsSkeleton } from "../_components/emails-header";
import { EmailSettingsForm, ProviderTestButton } from "./settings-form";

export const metadata: Metadata = { title: "Email settings" };

export default function EmailSettingsPage() {
  return (
    <Suspense fallback={<EmailsSkeleton label="Loading email settings" />}>
      <EmailSettings />
    </Suspense>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {on ? <CheckCircle2 className="size-4 text-success-700" aria-hidden /> : <CircleDashed className="size-4 text-muted" aria-hidden />}
      <code className="text-xs">{label}</code>
      <span className="text-xs text-muted">{on ? "set" : "not set"}</span>
    </li>
  );
}

async function EmailSettings() {
  const { access, denied } = await requireAccess(["marketing.view"]);
  if (denied) return <AccessDenied />;
  const canManage = access.permissions.includes("marketing.manage");
  const status = emailProviderStatus();
  const site = publicEnv().NEXT_PUBLIC_SITE_URL;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("email_settings").select("admin_recipients, reply_to, sender_name").eq("organization_id", access.organization.id).maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", msg: "email settings read failed", code: error.code }));
    throw new Error("Could not load email settings.");
  }

  return (
    <>
      <EmailsHeader active="settings" description="Who gets team notifications, and how email is sent." />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader icon={<IconTile icon={Server} color="indigo" size="sm" />} actions={<Badge tone={status.active ? "success" : "warning"}>{status.active ? (status.active === "smtp" ? "SMTP connected" : "Resend connected") : "Not configured"}</Badge>}>
            <CardTitle>Email provider</CardTitle>
            <CardDescription>Set with environment variables (in Vercel: Project → Settings → Environment Variables), then redeploy. Values are never shown here.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {!status.active ? (
              <Alert tone="warning" title="Emails are not being sent">
                Automations still run and every attempt is recorded in the email log as “Not sent”. Add one of the free options below to start sending.
              </Alert>
            ) : null}
            {status.note ? <Alert tone={status.active === "smtp" ? "info" : "warning"}>{status.note}</Alert> : null}
            <div>
              <p className="font-semibold">Option 1 — Gmail (free, about 500 emails/day)</p>
              <p className="mt-1 text-xs text-muted">
                Google Account → Security → 2-Step Verification → App passwords. Use <code>smtp.gmail.com</code>, port <code>465</code>, your Gmail address and the 16-character app password.
              </p>
              <ul className="mt-2 grid gap-1">
                <Flag on={status.smtp.host} label="SMTP_HOST" />
                <Flag on={status.smtp.port} label="SMTP_PORT" />
                <Flag on={status.smtp.user} label="SMTP_USER" />
                <Flag on={status.smtp.password} label="SMTP_PASSWORD" />
              </ul>
            </div>
            <div>
              <p className="font-semibold">Option 2 — Resend (free, 3,000 emails/month)</p>
              <p className="mt-1 text-xs text-muted">
                Without a domain verified in Resend, emails are delivered only to the address you signed up to Resend with — candidates will not receive them. Verify a domain you own before relying on it.
              </p>
              <ul className="mt-2 grid gap-1">
                <Flag on={status.resend.apiKey} label="RESEND_API_KEY" />
              </ul>
            </div>
            <div>
              <p className="font-semibold">Sender</p>
              <ul className="mt-2 grid gap-1">
                <Flag on={status.emailFrom} label="EMAIL_FROM" />
              </ul>
              <p className="mt-1 text-xs text-muted">
                e.g. <code>Adrenaline Rush &lt;you@gmail.com&gt;</code>. With Gmail it must be your Gmail address. Links and images in emails use <code className="break-all">{site}</code> (<code>NEXT_PUBLIC_SITE_URL</code>) — make sure this is your live site address.
              </p>
            </div>
            {canManage ? <ProviderTestButton email={access.email} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader icon={<IconTile icon={Users} color="teal" size="sm" />}>
            <CardTitle>Team notifications</CardTitle>
            <CardDescription>Who receives “new demo booking” emails (automations sent to “Team notification recipients”).</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? (
              <EmailSettingsForm
                readOnly={!canManage}
                initial={{ adminRecipients: (data.admin_recipients ?? []).join("\n"), replyTo: data.reply_to ?? "", senderName: data.sender_name ?? "" }}
                businessName={access.organization.name}
              />
            ) : (
              <Alert tone="warning">Email settings are missing. Run the latest supabase/setup.sql in the Supabase SQL Editor.</Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
