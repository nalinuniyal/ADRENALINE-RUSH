import "server-only";

/**
 * Email provider configuration, read from environment variables only.
 * Everything is optional: without a provider, emails are recorded in the log
 * as "not sent" and the rest of the app works normally.
 *
 *   Gmail / any SMTP:  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
 *   Resend:            RESEND_API_KEY
 *   Both:              EMAIL_FROM  e.g. "Adrenaline Rush <you@gmail.com>"
 * SMTP wins when both are configured.
 */

export type EmailProviderName = "smtp" | "resend";

export type SmtpConfig = { provider: "smtp"; host: string; port: number; secure: boolean; user: string; password: string; from: string };
export type ResendConfig = { provider: "resend"; apiKey: string; from: string };
export type EmailConfig = SmtpConfig | ResendConfig | { provider: null };

/** Resend's shared test sender: works without a verified domain (delivers only to your own Resend address). */
export const RESEND_TEST_FROM = "onboarding@resend.dev";

const env = (name: string) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
};

export function emailConfig(): EmailConfig {
  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const password = env("SMTP_PASSWORD");
  if (host && user && password) {
    const rawPort = Number(env("SMTP_PORT") ?? "465");
    const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : 465;
    return { provider: "smtp", host, port, secure: port === 465, user, password, from: env("EMAIL_FROM") ?? user };
  }
  const apiKey = env("RESEND_API_KEY");
  if (apiKey) return { provider: "resend", apiKey, from: env("EMAIL_FROM") ?? RESEND_TEST_FROM };
  return { provider: null };
}

/** What is configured, as booleans only — safe to show in the admin UI. Never includes values. */
export type EmailProviderStatus = {
  active: EmailProviderName | null;
  smtp: { host: boolean; port: boolean; user: boolean; password: boolean };
  resend: { apiKey: boolean };
  emailFrom: boolean;
  /** Provider-specific caveat to show to the admin. */
  note: string | null;
};

export function emailProviderStatus(): EmailProviderStatus {
  const cfg = emailConfig();
  let note: string | null = null;
  if (cfg.provider === "resend" && cfg.from.includes(RESEND_TEST_FROM)) {
    note = "Resend is using its test sender. Until you verify your own domain in Resend, emails are delivered ONLY to the address you signed up to Resend with — candidates will not receive them.";
  } else if (cfg.provider === "resend") {
    note = "Resend only delivers from a domain you have verified in Resend. Without a verified domain it delivers only to your own Resend account address.";
  } else if (cfg.provider === "smtp" && /gmail\.com$/i.test(cfg.host)) {
    note = "Gmail allows about 500 emails a day and needs an App Password (not your normal password).";
  }
  const partialSmtp = Boolean(env("SMTP_HOST") || env("SMTP_USER") || env("SMTP_PASSWORD")) && cfg.provider !== "smtp";
  if (partialSmtp) note = "SMTP is only partly configured: SMTP_HOST, SMTP_USER and SMTP_PASSWORD are all required.";
  return {
    active: cfg.provider,
    smtp: { host: Boolean(env("SMTP_HOST")), port: Boolean(env("SMTP_PORT")), user: Boolean(env("SMTP_USER")), password: Boolean(env("SMTP_PASSWORD")) },
    resend: { apiKey: Boolean(env("RESEND_API_KEY")) },
    emailFrom: Boolean(env("EMAIL_FROM")),
    note,
  };
}

/**
 * The From header. If EMAIL_FROM is a bare address and a sender name is set
 * in the dashboard, the name is added: "Name" <address>.
 */
export function formatFrom(from: string, senderName?: string | null): string {
  const name = senderName?.replace(/["\\\r\n<>]/g, "").trim();
  if (!name || from.includes("<")) return from;
  return `"${name}" <${from}>`;
}
