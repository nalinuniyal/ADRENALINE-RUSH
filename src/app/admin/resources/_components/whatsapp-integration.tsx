import { Badge } from "@/components/ui/badge";
import type { Access } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WhatsappCountryCodeForm } from "./whatsapp-country-code-form";

/** Settings › Integrations row: WhatsApp click-to-chat (free, no API) and its default country code. */
export async function WhatsappIntegrationRow({ access }: { access: Access }) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("sharing_settings").select("whatsapp_country_code").eq("organization_id", access.organization.id).maybeSingle();
  const canEdit = access.permissions.includes("settings.manage") || access.permissions.includes("integrations.manage");
  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>WhatsApp</span>
        <Badge tone="success">Click-to-chat ready</Badge>
      </div>
      <p className="text-xs text-muted">
        “Open WhatsApp” on the share screen opens a chat with the candidate and your message already typed; you press send. It is free and needs no
        account setup. The WhatsApp Business (Cloud) API for automatic sending is optional and not built yet.
      </p>
      {data ? (
        canEdit ? (
          <WhatsappCountryCodeForm initial={data.whatsapp_country_code} />
        ) : (
          <p className="text-xs text-muted">Default country code: +{data.whatsapp_country_code}</p>
        )
      ) : (
        <p className="text-xs text-warning-700">Run the latest supabase/setup.sql to set the default country code.</p>
      )}
    </li>
  );
}
