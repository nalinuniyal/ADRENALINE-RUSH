/**
 * UPI and bank-transfer helpers (client-safe, no server imports).
 *
 * A UPI payment link follows NPCI's deep-link format
 *   upi://pay?pa=<vpa>&pn=<payee>&am=<amount>&cu=INR&tn=<note>
 * Every UPI app (Google Pay, PhonePe, Paytm, BHIM, bank apps) opens it on a
 * phone, and the same text in a QR code pre-fills the amount when scanned.
 */

/** UPI ID (VPA): handle@psp, e.g. yourname@okhdfcbank. Same rule as the database CHECK. */
export const VPA_RE = /^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,35}$/;
/** IFSC: 4 letters (bank), a zero, 6 letters/digits (branch). */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers are 9–18 digits. */
export const ACCOUNT_NUMBER_RE = /^[0-9]{9,18}$/;
/** UTR / UPI transaction reference after normalising (upper case, no spaces or dashes). */
export const UTR_RE = /^[A-Z0-9]{6,35}$/;

export const normalizeVpa = (v: string) => v.trim().toLowerCase();
export const normalizeIfsc = (v: string) => v.trim().toUpperCase();
export const normalizeAccountNumber = (v: string) => v.replace(/\s+/g, "");
export const normalizeUtr = (v: string) => v.replace(/[\s-]+/g, "").toUpperCase();

export const isValidVpa = (v: string) => VPA_RE.test(normalizeVpa(v)) && normalizeVpa(v).length <= 100;
export const isValidIfsc = (v: string) => IFSC_RE.test(normalizeIfsc(v));
export const isValidAccountNumber = (v: string) => ACCOUNT_NUMBER_RE.test(normalizeAccountNumber(v));
export const isValidUtr = (v: string) => UTR_RE.test(normalizeUtr(v));

/** "123456789012" → "•••• 9012"; short or empty values are fully hidden. */
export function maskAccountNumber(v: string | null | undefined): string {
  const digits = (v ?? "").replace(/\s+/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return "••••";
  return `•••• ${digits.slice(-4)}`;
}

/** Longest note we put in a UPI link. Some apps cut or reject longer ones. */
export const UPI_NOTE_MAX = 50;
/** Longest payee name we put in a UPI link. */
export const UPI_PAYEE_MAX = 50;

/** Keeps letters, digits, spaces and a few safe marks; collapses whitespace; trims to max. */
function clean(text: string, max: number): string {
  const s = text
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N} .,&()/_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length <= max ? s : s.slice(0, max).trim();
}

/** Note shown in the payer's UPI app and on the owner's statement: "<course> <ref>". */
export function upiNote(courseTitle: string | null | undefined, reference: string): string {
  const ref = clean(reference, 20);
  const room = UPI_NOTE_MAX - ref.length - 1;
  const course = room > 3 ? clean(courseTitle ?? "", room) : "";
  return course ? `${course} ${ref}` : ref;
}

/** Paise → "1234.50" (UPI wants exactly two decimals, no separators). */
export function upiAmount(paise: number): string {
  if (!Number.isInteger(paise) || paise <= 0) throw new Error("UPI amount must be a positive number of paise");
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

/** RFC 3986 encoding; the "@" of the UPI ID stays readable (all UPI apps accept it). */
const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type UpiLinkInput = {
  vpa: string;
  payeeName?: string | null;
  /** Omit for an open amount (the payer types it). */
  amountPaise?: number | null;
  note?: string | null;
  currency?: string;
};

export function buildUpiLink(input: UpiLinkInput): string {
  const vpa = normalizeVpa(input.vpa);
  if (!isValidVpa(vpa)) throw new Error("Not a valid UPI ID");
  const parts = [`pa=${enc(vpa).replace(/%40/g, "@")}`];
  const payee = clean(input.payeeName ?? "", UPI_PAYEE_MAX);
  if (payee) parts.push(`pn=${enc(payee)}`);
  if (input.amountPaise != null) parts.push(`am=${upiAmount(input.amountPaise)}`);
  parts.push(`cu=${input.currency ?? "INR"}`);
  const note = clean(input.note ?? "", UPI_NOTE_MAX);
  if (note) parts.push(`tn=${enc(note)}`);
  return `upi://pay?${parts.join("&")}`;
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = { savings: "Savings", current: "Current", other: "Other" };

/** Fills {{placeholders}} in owner-editable text; unknown ones are left as they are. */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => (key in values ? values[key] : m));
}

export const CONFIRM_EMAIL_PLACEHOLDERS = ["first_name", "amount", "course", "receipt_number", "outstanding", "business_name", "utr"] as const;
