import { formatDate } from "@/lib/format";
import { formatPaise } from "@/lib/finance/money";

export type ReminderInput = {
  candidateName: string;
  businessName: string;
  courseTitle: string;
  /** e.g. "Installment 2" or the installment's own label; null for the whole fee. */
  installmentLabel: string | null;
  duePaise: number;
  dueDate: string | null;
  outstandingPaise: number;
  currency: string;
  today: string;
  paymentUrl?: string | null;
  /** The free UPI / bank-transfer pay page (/pay/<token>), when one is live. */
  payPageUrl?: string | null;
  /** The owner's UPI ID, when "show in reminders" is on. */
  upiId?: string | null;
};

/** Polite, plain-text fee reminder for WhatsApp or email. */
export function buildReminderMessage(r: ReminderInput): { subject: string; body: string } {
  const first = r.candidateName.trim().split(/\s+/)[0] || "there";
  const what = r.installmentLabel ? `${r.installmentLabel} of ${formatPaise(r.duePaise, r.currency)}` : `the fee of ${formatPaise(r.duePaise, r.currency)}`;
  const when = r.dueDate ? (r.dueDate < r.today ? ` was due on ${formatDate(r.dueDate)}` : ` is due on ${formatDate(r.dueDate)}`) : " is pending";
  const lines = [
    `Hi ${first},`,
    "",
    `This is a friendly reminder from ${r.businessName} that ${what} for ${r.courseTitle}${when}.`,
    r.outstandingPaise > r.duePaise ? `Total still payable: ${formatPaise(r.outstandingPaise, r.currency)}.` : null,
    r.paymentUrl ? `You can pay securely online here: ${r.paymentUrl}` : null,
    r.payPageUrl ? `Pay by UPI (scan the QR) or bank transfer here: ${r.payPageUrl}` : null,
    !r.payPageUrl && r.upiId ? `You can pay by UPI to ${r.upiId}.` : null,
    r.paymentUrl || r.payPageUrl ? null : "Please reply to this message once you have paid, or if you have any questions.",
    "",
    "Thank you!",
    r.businessName,
  ].filter((l): l is string => l !== null);
  return { subject: `Fee reminder: ${r.courseTitle}`, body: lines.join("\n") };
}

export type PayLinkMessageInput = {
  candidateName: string;
  businessName: string;
  courseTitle: string;
  /** e.g. "Installment 2"; null for the whole balance. */
  label: string | null;
  amountPaise: number;
  currency: string;
  url: string;
  upiId?: string | null;
};

/** Message that shares the UPI / bank-transfer pay page. */
export function buildPayLinkMessage(r: PayLinkMessageInput): { subject: string; body: string } {
  const first = r.candidateName.trim().split(/\s+/)[0] || "there";
  const what = r.label ? `${r.label} (${formatPaise(r.amountPaise, r.currency)})` : formatPaise(r.amountPaise, r.currency);
  const lines = [
    `Hi ${first},`,
    "",
    `You can pay ${what} for ${r.courseTitle} by UPI or bank transfer on this page. Scan the QR code or tap "Pay with UPI app", then send us the transaction reference (UTR) on the same page:`,
    r.url,
    r.upiId ? `UPI ID: ${r.upiId}` : null,
    "",
    "Thank you!",
    r.businessName,
  ].filter((l): l is string => l !== null);
  return { subject: `Pay your fee for ${r.courseTitle}`, body: lines.join("\n") };
}
