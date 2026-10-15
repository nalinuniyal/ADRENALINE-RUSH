import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/admin/access-denied";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { roleLabel, type MemberRole } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PaymentGatewayRow } from "../finance/_components/payment-gateway-row";
import { WhatsappIntegrationRow } from "../resources/_components/whatsapp-integration";
import { CredentialsForm } from "./credentials-form";
import { GoogleIntegrationRow } from "./google-integration";
import { LeadStatusesCard } from "./lead-statuses";
import { OrganizationSettingsForm } from "./organization-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const { access, denied } = await requireAccess(["settings.manage", "members.manage", "roles.manage", "integrations.manage"]);
  if (denied) return <AccessDenied />;
  const googleParam = (await searchParams).google;
  const googleCallback = typeof googleParam === "string" ? googleParam : undefined;

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
      .select("id, user_id, role, status, created_at, user_profiles(full_name, email), custom_roles(name)")
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
          <Card id="business-profile">
            <CardHeader>
              <CardTitle>Business profile</CardTitle>
              <CardDescription>Used across the dashboard, your public pages and emails.</CardDescription>
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

        {canManageSettings || access.permissions.includes("finance.manage") ? (
          <Card id="payment-details">
            <CardHeader>
              <CardTitle>Payment details</CardTitle>
              <CardDescription>Your UPI ID and bank account for students to pay you directly (free, you confirm each payment).</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/admin/settings/payments" className={buttonVariants({ variant: "secondary" })}>
                Edit payment details
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

        {access.permissions.includes("members.manage") ? (
          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
              <CardDescription>
                {(membersRes.data ?? []).filter((m) => m.status === "active").length} active member(s). Invite administrators, staff and
                instructors, change roles and switch access off. The switches in Business profile decide whether staff and instructors can
                sign in at all.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(membersRes.data ?? []).map((m) => {
                const profile = Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles;
                return (
                  <Badge key={m.id} tone={m.status === "active" ? "neutral" : "warning"}>
                    {profile?.full_name || profile?.email} · {roleLabel(m.role as MemberRole, (Array.isArray(m.custom_roles) ? m.custom_roles[0] : m.custom_roles)?.name)}
                  </Badge>
                );
              })}
              <Link href="/admin/settings/team" className={buttonVariants({ variant: "secondary", size: "sm" }) + " basis-full sm:basis-auto"}>
                Manage team
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {access.permissions.includes("roles.manage") ? (
          <Card id="roles">
            <CardHeader>
              <CardTitle>Roles &amp; access</CardTitle>
              <CardDescription>
                Choose what administrators, staff and instructors can see and do, and create your own roles such as “Accounts” or “Senior instructor”.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/admin/settings/roles" className={buttonVariants({ variant: "secondary" })}>
                Manage roles &amp; access
              </Link>
            </CardContent>
          </Card>
        ) : null}

        <Card id="integrations">
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
              <WhatsappIntegrationRow access={access} />
              <GoogleIntegrationRow
                supabase={supabase}
                orgId={access.organization.id}
                canManage={access.permissions.includes("integrations.manage")}
                callback={googleCallback}
                memberName={(id) => {
                  const m = (membersRes.data ?? []).find((x) => x.user_id === id);
                  const p = m ? (Array.isArray(m.user_profiles) ? m.user_profiles[0] : m.user_profiles) : null;
                  return p?.full_name || p?.email || "a team member";
                }}
                timeZone={access.organization.timezone}
              />
              <PaymentGatewayRow />
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
