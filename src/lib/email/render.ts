/**
 * Renders an email template to { subject, html, text }. Pure and isomorphic:
 * the server uses it to send, the editor uses it for the live preview.
 *
 * The structured design produces a table-based, inline-styled layout that
 * works in Gmail, Outlook and Apple Mail and stacks nicely on phones.
 * Every variable value is HTML-escaped; admin-written text is plain text.
 */
import { htmlToText, sanitizeEmailHtml } from "@/lib/email/sanitize";
import { escapeHtml, substitute, type EmailVariables } from "@/lib/email/variables";

export type EmailDesign = {
  header_image_url?: string | null;
  header_image_asset_id?: string | null;
  heading?: string | null;
  body?: string | null;
  button_label?: string | null;
  button_url?: string | null;
  footer_text?: string | null;
  accent_color?: string | null;
};

export type RenderableTemplate = {
  subject: string;
  preheader?: string | null;
  design: EmailDesign;
  custom_html?: string | null;
  use_custom_html?: boolean;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export const DEFAULT_ACCENT = "#0176d3";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Coerces stored jsonb into a design object, ignoring unknown or non-string keys. */
export function toDesign(value: unknown): EmailDesign {
  const src = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const keys: (keyof EmailDesign)[] = ["header_image_url", "header_image_asset_id", "heading", "body", "button_label", "button_url", "footer_text", "accent_color"];
  const out: EmailDesign = {};
  for (const k of keys) if (typeof src[k] === "string") out[k] = src[k] as string;
  return out;
}

export function safeAccent(color: string | null | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_ACCENT;
}

/** White or near-black text, whichever reads better on the accent colour. */
export function contrastText(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#181818" : "#ffffff";
}

/**
 * Absolute http(s) URL for links and images: "/path" is resolved against the
 * site URL, mailto:/tel: are allowed for links, anything else is dropped.
 */
export function resolveUrl(raw: string | null | undefined, siteUrl: string, allowContact = false): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return `${siteUrl.replace(/\/+$/, "")}${v}`;
  if (/^https?:\/\/[^\s<>"]+$/i.test(v)) return v;
  if (allowContact && /^(mailto|tel):[^\s<>"]+$/i.test(v)) return v;
  return null;
}

export function renderSubject(subject: string, vars: EmailVariables): string {
  const s = substitute(subject, vars, "text").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return (s || "(no subject)").slice(0, 200);
}

function paragraphs(text: string, vars: EmailVariables): string[] {
  return substitute(text, vars, "text")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => escapeHtml(p).replace(/\n/g, "<br>"));
}

function plain(text: string | null | undefined, vars: EmailVariables): string {
  return substitute(text ?? "", vars, "text").replace(/\r\n?/g, "\n").trim();
}

export function renderEmail(t: RenderableTemplate, vars: EmailVariables, opts: { siteUrl: string }): RenderedEmail {
  const subject = renderSubject(t.subject, vars);
  const preheader = plain(t.preheader, vars).replace(/\s+/g, " ");

  if (t.use_custom_html && t.custom_html?.trim()) {
    // Sanitised before and after substitution, so variable values cannot add active content either.
    const body = sanitizeEmailHtml(substitute(sanitizeEmailHtml(t.custom_html), vars, "html"));
    const html = /<html[\s>]/i.test(body)
      ? body
      : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;">${preheaderBlock(preheader)}${body}</body></html>`;
    return { subject, html, text: htmlToText(body) };
  }

  const d = t.design;
  const accent = safeAccent(d.accent_color);
  const onAccent = contrastText(accent);
  const heading = plain(d.heading, vars);
  const bodyParas = paragraphs(d.body ?? "", vars);
  const footer = paragraphs(d.footer_text ?? "", vars);
  const image = resolveUrl(d.header_image_url, opts.siteUrl);
  const buttonLabel = plain(d.button_label, vars);
  const buttonUrl = resolveUrl(substitute(d.button_url ?? "", vars, "text"), opts.siteUrl, true);
  const businessName = vars.business_name ?? "";

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  @media only screen and (max-width: 620px) {
    .ar-container { width: 100% !important; }
    .ar-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .ar-h1 { font-size: 22px !important; line-height: 30px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f3f3f3;">
${preheaderBlock(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f3f3;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" class="ar-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">
        <tr><td style="height:6px;line-height:6px;font-size:0;background-color:${accent};">&nbsp;</td></tr>
${
  image
    ? `        <tr><td style="padding:0;"><img src="${escapeHtml(image)}" width="600" alt="${escapeHtml(heading || businessName)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>\n`
    : ""
}${
  heading
    ? `        <tr><td class="ar-pad" style="padding:28px 40px 4px 40px;font-family:${FONT};"><h1 class="ar-h1" style="margin:0;font-size:24px;line-height:32px;font-weight:700;color:#181818;">${escapeHtml(heading)}</h1></td></tr>\n`
    : ""
}        <tr><td class="ar-pad" style="padding:16px 40px 8px 40px;font-family:${FONT};font-size:16px;line-height:26px;color:#3e3e3c;">
${bodyParas.map((p) => `          <p style="margin:0 0 16px 0;">${p}</p>`).join("\n")}
        </td></tr>
${
  buttonLabel && buttonUrl
    ? `        <tr><td class="ar-pad" style="padding:4px 40px 28px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" bgcolor="${accent}" style="border-radius:6px;background-color:${accent};">
              <a href="${escapeHtml(buttonUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:${onAccent};text-decoration:none;border-radius:6px;">${escapeHtml(buttonLabel)}</a>
            </td>
          </tr></table>
        </td></tr>\n`
    : ""
}${
  footer.length
    ? `        <tr><td class="ar-pad" style="padding:18px 40px 24px 40px;border-top:1px solid #eeeeee;font-family:${FONT};font-size:12px;line-height:18px;color:#706e6b;">
${footer.map((p) => `          <p style="margin:0 0 8px 0;">${p}</p>`).join("\n")}
        </td></tr>\n`
    : ""
}      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textParts = [heading, plain(d.body, vars), buttonLabel && buttonUrl ? `${buttonLabel}: ${buttonUrl}` : "", plain(d.footer_text, vars) ? `--\n${plain(d.footer_text, vars)}` : ""];
  const text = textParts.filter(Boolean).join("\n\n");
  return { subject, html, text };
}

function preheaderBlock(preheader: string): string {
  if (!preheader) return "";
  // Hidden preview text shown by inbox lists next to the subject.
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f3f3f3;opacity:0;">${escapeHtml(preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>`;
}
