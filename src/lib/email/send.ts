import "server-only";
import nodemailer from "nodemailer";
import { emailConfig, formatFrom, type EmailProviderName, type ResendConfig, type SmtpConfig } from "@/lib/email/config";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  senderName?: string | null;
};

export type SendOutcome = {
  status: "sent" | "failed" | "not_sent";
  provider: EmailProviderName | null;
  messageId: string | null;
  error: string | null;
};

export const SEND_TIMEOUT_MS = 10_000;
export const NO_PROVIDER = "No email provider configured";

/** Error text safe to store: addresses redacted, single line, bounded. */
export function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return raw
    .replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, "[address]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || "Unknown error";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function sendSmtp(cfg: SmtpConfig, msg: OutgoingEmail): Promise<string | null> {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  try {
    const info = await withTimeout(
      transport.sendMail({
        from: formatFrom(cfg.from, msg.senderName),
        to: msg.to,
        replyTo: msg.replyTo ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      SEND_TIMEOUT_MS,
    );
    return typeof info.messageId === "string" ? info.messageId.slice(0, 300) : null;
  } finally {
    transport.close();
  }
}

async function sendResend(cfg: ResendConfig, msg: OutgoingEmail): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: formatFrom(cfg.from, msg.senderName),
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown; name?: unknown } | null;
  if (!res.ok) {
    const detail = typeof body?.message === "string" ? body.message : res.statusText;
    throw new Error(`Resend ${res.status}: ${detail}`);
  }
  return typeof body?.id === "string" ? body.id.slice(0, 300) : null;
}

/**
 * Sends one email through the configured provider. Never throws and never
 * pretends: without a provider the outcome is "not_sent"; any error or
 * timeout is "failed" with a redacted reason. Logs contain no addresses or content.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<SendOutcome> {
  const cfg = emailConfig();
  if (!cfg.provider) return { status: "not_sent", provider: null, messageId: null, error: NO_PROVIDER };
  try {
    const messageId = cfg.provider === "smtp" ? await sendSmtp(cfg, msg) : await sendResend(cfg, msg);
    console.info(JSON.stringify({ level: "info", msg: "email sent", provider: cfg.provider }));
    return { status: "sent", provider: cfg.provider, messageId, error: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(JSON.stringify({ level: "error", msg: "email send failed", provider: cfg.provider, error: name }));
    return { status: "failed", provider: cfg.provider, messageId: null, error: cleanError(error) };
  }
}
