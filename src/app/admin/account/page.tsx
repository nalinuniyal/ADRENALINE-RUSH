import type { Metadata } from "next";
import { Suspense } from "react";
import { UserRound } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { roleLabel } from "@/lib/auth/permissions";
import { requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CredentialsForm } from "../settings/credentials-form";
import { ProfileForm } from "../settings/profile-form";

export const metadata: Metadata = { title: "My account" };

/** Every team member's own name, email and password (no permission needed beyond an active membership). */
export default function AccountPage() {
  return (
    <Suspense fallback={<div className="ar-skeleton h-[60vh] rounded-[var(--radius-card)]" aria-busy="true" aria-label="Loading" />}>
      <Account />
    </Suspense>
  );
}

async function Account() {
  const { access } = await requireAccess();
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from("user_profiles").select("full_name").eq("id", access.userId).single();

  return (
    <>
      <PageHeader
        title="My account"
        icon={UserRound}
        color="slate"
        description={`${roleLabel(access.role, access.customRole?.name)} at ${access.organization.name}`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription>{access.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm initialName={profile?.full_name ?? ""} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sign-in details</CardTitle>
            <CardDescription>Change the email and password you use at /admin.</CardDescription>
          </CardHeader>
          <CardContent>
            <CredentialsForm email={access.email} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
