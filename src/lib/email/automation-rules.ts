/** Pure rules for email automations (kept free of server imports so they are unit-testable). */

export const AUTOMATION_CHANNELS = ["demo_request", "public_form", "any"] as const;
export type AutomationChannel = (typeof AUTOMATION_CHANNELS)[number];
export const AUTOMATION_RECIPIENTS = ["candidate", "admins", "custom"] as const;
export type AutomationRecipient = (typeof AUTOMATION_RECIPIENTS)[number];

export const CHANNEL_LABELS: Record<AutomationChannel, string> = {
  demo_request: "Demo class bookings",
  public_form: "Course registrations (not demo)",
  any: "Any registration or demo booking",
};

export const RECIPIENT_LABELS: Record<AutomationRecipient, string> = {
  candidate: "The candidate",
  admins: "Team notification recipients",
  custom: "Specific email addresses",
};

export type AutomationRule = { course_id: string | null; channel: string; is_active: boolean };
export type RegistrationFacts = { course_id: string | null; channel: string };

/** Does this automation fire for this registration? A null course means every course. */
export function automationMatches(a: AutomationRule, reg: RegistrationFacts): boolean {
  if (!a.is_active) return false;
  if (a.course_id !== null && a.course_id !== reg.course_id) return false;
  return a.channel === "any" || a.channel === reg.channel;
}

export type Recipient = { to: string | null; skipReason: string | null };

const EMAIL_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

export function normalizeAddress(v: string | null | undefined): string | null {
  const a = (v ?? "").trim().toLowerCase();
  return EMAIL_RE.test(a) && a.length <= 254 ? a : null;
}

/** Who receives one automation's email. Invalid or missing addresses become "not sent" entries with a reason. */
export function resolveRecipients(
  recipient: string,
  ctx: { candidateEmail: string | null; doNotContact: boolean; adminRecipients: string[]; customEmails: string[]; fallbackAdmins: string[] },
): Recipient[] {
  const dedupe = (list: string[]) => {
    const out: Recipient[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      const to = normalizeAddress(raw);
      if (to && !seen.has(to)) {
        seen.add(to);
        out.push({ to, skipReason: null });
      }
    }
    return out.slice(0, 20);
  };
  if (recipient === "candidate") {
    if (ctx.doNotContact) return [{ to: normalizeAddress(ctx.candidateEmail), skipReason: "Candidate is marked “do not contact”" }];
    const to = normalizeAddress(ctx.candidateEmail);
    return [to ? { to, skipReason: null } : { to: null, skipReason: "Candidate has no valid email address" }];
  }
  if (recipient === "admins") {
    const list = dedupe(ctx.adminRecipients.length ? ctx.adminRecipients : ctx.fallbackAdmins);
    return list.length ? list : [{ to: null, skipReason: "No team notification recipients are set" }];
  }
  if (recipient === "custom") {
    const list = dedupe(ctx.customEmails);
    return list.length ? list : [{ to: null, skipReason: "No recipient addresses are set" }];
  }
  return [{ to: null, skipReason: "Unknown recipient type" }];
}
