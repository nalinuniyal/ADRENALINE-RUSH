import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { ROLE_LABELS, type MemberRole } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CredentialsForm } from "./credentials-form";
import { LeadStatusesCard } from "./lead-statuses";
import { OrganizationSettingsForm } from "./organization-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { access, denied } = await requireAccess(["settings.manage", "members.manage", "integrations.manage"]);
  if (denied) return <AccessDenied />;

  const supabase = await createSupabaseServerClient();
  const [orgRes, membersRes, profileRes] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "name, contact_email, contact_phone, website_url, logo_url, timezone, default_currency, staff_enabled, instructors_enabled",
      )
      .eq("id", access.organization.id)
      .single(),
    supabase
      .from("organization_memberships")
      .select("id, role, status, created_at, user_profiles(full_name, email)")
      .eq("organization_id", access.organization.id)
      .order("created_at"),
    supabase.from("user_profiles").select("full_name").eq("id", access.userId).single(),
  ]);

  if (orgRes.error || !orgRes.data) throw new Error("Could not load settings.");
  const org = orgRes.data;
  const canManageSettings = access.permissions.includes("settings.manage");

  return (
    <>
      <PageHeader title="Settings" description="Business profile, team access and integrations." />
      <div className="grid gap-6">
        {canManageSettings ? (
          <Card>
            <CardHeader>
              <CardTitle>Business profile</CardTitle>
              <CardDescription>Used across the dashboard and, from Phase 2, on your public pages.</CardDescription>
            </CardHeader>
            <CardContent>
              <OrganizationSettingsForm
                initial={{
                  name: org.name,
                  contactEmail: org.contact_email ?? "",
                  contactPhone: org.contact_phone ?? "",
                  websiteUrl: org.website_url ?? "",
                  logoUrl: org.logo_url ?? "",
                  timezone: org.timezone,
                  defaultCurrency: org.default_currency,
                  staffEnabled: org.staff_enabled,
                  instructorsEnabled: org.instructors_enabled,
                }}
              />
            </CardContent>
          </Card>
        ) : null}

        {canManageSettings ? (
          <Card>
            <CardHeader>
              <CardTitle>Website</CardTitle>
              <CardDescription>Home page text, featured course, contact details and social links on your public site.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/admin/settings/website" className={buttonVariants({ variant: "secondary" })}>
                Edit website settings
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {canManageSettings ? <LeadStatusesCard organizationId={access.organization.id} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>{access.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm initialName={profileRes.data?.full_name ?? ""} />
          </CardContent>
        </Card>

        <Card id="sign-in">
          <CardHeader>
            <CardTitle>Sign-in details</CardTitle>
            <CardDescription>Change the email and password you use at /admin.</CardDescription>
          </CardHeader>
          <CardContent>
            <CredentialsForm email={access.email} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>
              Staff and instructor invitations are added in a later phase. The switches in Business profile decide
              whether those roles can sign in at all.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Name</th>
                  <th scope="col" className="px-5 py-3 font-medium">Role</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(membersRes.data ?? []).map((m) => {
                  const profile = Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles;
                  return (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <p className="font-medium">{profile?.full_name || "—"}</p>
                        <p className="text-xs text-muted">{profile?.email}</p>
                      </td>
                      <td className="px-5 py-3">{ROLE_LABELS[m.role as MemberRole]}</td>
                      <td className="px-5 py-3">
                        <Badge tone={m.status === "active" ? "success" : "neutral"}>{m.status}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Optional. Every workflow has a manual fallback.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line text-sm">
              {/* Email (managed under Marketing → Emails) */}
              <li className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>Email notifications &amp; provider</span>
                <Link href="/admin/marketing/emails/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Email settings
                </Link>
              </li>
              {[
                { name: "Google Calendar & Meet", phase: 5 },
                { name: "WhatsApp Business API", phase: 8 },
                { name: "Payment gateway", phase: 9 },
              ].map((i) => (
                <li key={i.name} className="flex items-center justify-between py-3">
                  <span>{i.name}</span>
                  <Badge>Not connected · Phase {i.phase}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
