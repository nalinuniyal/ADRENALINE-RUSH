import { ListOrdered } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { getLeadStatuses } from "@/lib/data/candidates";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LeadStatusSettings } from "./lead-statuses-editor";

/** Settings card for the candidate pipeline. Render only for settings.manage (RLS enforces it too). */
export async function LeadStatusesCard({ organizationId }: { organizationId: string }) {
  const supabase = await createSupabaseServerClient();
  const statuses = await getLeadStatuses(supabase, organizationId);
  return (
    <Card>
      <CardHeader icon={<IconTile icon={ListOrdered} color="orange" size="sm" />}>
        <CardTitle>Lead statuses</CardTitle>
        <CardDescription>
          The steps of your candidate pipeline, in order. Closed statuses end the pipeline; “won” marks an enrolment. Statuses that candidates use cannot be
          deleted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LeadStatusSettings statuses={statuses} />
      </CardContent>
    </Card>
  );
}
