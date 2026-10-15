import "server-only";
import { roleLabel, type MemberRole } from "@/lib/auth/permissions";
import { loadEmailSettings, siteUrl, toRenderable } from "@/lib/email/automations";
import { renderEmail, type RenderableTemplate } from "@/lib/email/render";
import { sendEmail, type SendOutcome } from "@/lib/email/send";
import { firstName, type EmailVariables } from "@/lib/email/variables";
import { formatDate } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const TEAM_INVITATION_TEMPLATE_KEY = "team_invitation";

/** Used when the editable template has been deleted. Matches the seeded template. */
export const DEFAULT_INVITATION_TEMPLATE: RenderableTemplate = {
  subject: "{{inviter_name}} invited you to join {{business_name}}",
  preheader: "Set your password to start using the {{business_name}} dashboard.",
  design: {
    heading: "You're invited, {{invitee_name}}",
    body: "{{inviter_name}} has invited you to join {{business_name}} as {{invite_role}}.\n\nClick the button below to choose your password and sign in. The link works once and expires on {{invite_expires}}.\n\nIf you were not expecting this invitation, you can ignore this email.",
    button_label: "Accept invitation",
    button_url: "{{invite_url}}",
    footer_text: "Sent by {{business_name}}. Please do not forward this email: the link gives access to the team dashboard.",
    accent_color: "#0176d3",
  },
};

export type InvitationEmailInput = {
  organizationId: string;
  businessName: string;
  timezone: string;
  inviterName: string;
  inviteeName: string;
  email: string;
  role: MemberRole;
  /** Custom role name ("Accounts"), shown instead of the built-in label. */
  roleName?: string | null;
  url: string;
  expiresAt: Date;
};

export function invitationVariables(p: InvitationEmailInput): EmailVariables {
  return {
    business_name: p.businessName,
    invitee_name: firstName(p.inviteeName) || p.inviteeName,
    invite_role: roleLabel(p.role, p.roleName),
    inviter_name: p.inviterName,
    invite_url: p.url,
    invite_expires: formatDate(p.expiresAt, p.timezone),
  };
}

/**
 * Sends the invitation through the configured provider (never throws). The
 * caller has already authorised the invite; the privileged client is used
 * only to read the template, which member managers may not be able to see.
 */
export async function sendInvitationEmail(p: InvitationEmailInput): Promise<SendOutcome> {
  try {
    const admin = createSupabaseAdminClient();
    const [{ data: tpl }, settings] = await Promise.all([
      admin
        .from("email_templates")
        .select("subject, preheader, design, custom_html, use_custom_html")
        .eq("organization_id", p.organizationId)
        .eq("key", TEAM_INVITATION_TEMPLATE_KEY)
        .maybeSingle(),
      loadEmailSettings(admin, p.organizationId),
    ]);
    const template = tpl ? toRenderable(tpl) : DEFAULT_INVITATION_TEMPLATE;
    const rendered = renderEmail(template, invitationVariables(p), { siteUrl: siteUrl() });
    return await sendEmail({ to: p.email, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: settings.replyTo, senderName: settings.senderName });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "invitation email failed", error: error instanceof Error ? error.name : "Error" }));
    return { status: "failed", provider: null, messageId: null, error: "Could not prepare the email" };
  }
}
