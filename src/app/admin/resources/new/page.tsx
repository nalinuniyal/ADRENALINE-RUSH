import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/admin/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResourceForm } from "../_components/resource-form";
import { ResourcesHeader, ResourcesSkeleton } from "../_components/resources-header";

export const metadata: Metadata = { title: "New resource" };

export default function NewResourcePage({ searchParams }: PageProps<"/admin/resources/new">) {
  return (
    <Suspense fallback={<ResourcesSkeleton label="Loading" />}>
      <NewResource searchParams={searchParams} />
    </Suspense>
  );
}

async function NewResource({ searchParams }: { searchParams: PageProps<"/admin/resources/new">["searchParams"] }) {
  const { access, denied } = await requireAccess(["resources.manage"]);
  if (denied) return <AccessDenied />;
  const supabase = await createSupabaseServerClient();
  const { data: courses } = await supabase.from("courses").select("id, title, status").eq("organization_id", access.organization.id).neq("status", "archived").order("title");
  const raw = await searchParams;
  const preset = typeof raw.course === "string" && (courses ?? []).some((c) => c.id === raw.course) ? [raw.course] : [];

  return (
    <>
      <ResourcesHeader active={null} title="New resource" crumbs={[{ label: "Demos & Resources", href: "/admin/resources" }, { label: "New" }]} />
      <Card>
        <CardContent className="py-5">
          <ResourceForm
            courses={courses ?? []}
            initial={{
              title: "",
              type: "demo_video",
              url: "",
              description: "",
              thumbnailUrl: "",
              visibility: "shareable",
              isActive: true,
              accessInstructions: "",
              expiresOn: "",
              courseIds: preset,
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
