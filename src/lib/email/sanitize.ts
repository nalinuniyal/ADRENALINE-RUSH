/**
 * Conservative clean-up for admin-written custom email HTML. Email clients
 * sanitise again and the editor preview runs in a script-less sandboxed
 * iframe, so this is defence in depth: it removes scripts and other active
 * content, event-handler attributes and javascript:/vbscript:/data: URLs
 * (data: images are allowed).
 */

const BLOCK_WITH_CONTENT = /<(script|iframe|object|embed|applet|frameset|frame|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_TAGS = /<\/?(script|iframe|object|embed|applet|frameset|frame|form|input|button|textarea|select|option|base|link|meta|noscript|template|svg|math|portal)\b[^>]*>/gi;
const EVENT_ATTR = /(<[^>]*?)[\s/]+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR = /([\s/])(href|src|action|background|poster|formaction|xlink:href|srcset|lowsrc|dynsrc|cite|longdesc)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
}

function decodeEntities(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => codePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => codePoint(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;|&newline;/gi, "");
}

export function isDangerousUrl(raw: string): boolean {
  const v = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]+/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  if (v.startsWith("data:")) return !/^data:image\/(png|jpe?g|gif|webp);/.test(v);
  return false;
}

function once(html: string): string {
  let out = html.replace(BLOCK_WITH_CONTENT, "").replace(DANGEROUS_TAGS, "");
  let prev: string;
  do {
    prev = out;
    out = out.replace(EVENT_ATTR, "$1");
  } while (out !== prev);
  out = out.replace(URL_ATTR, (m, sep: string, attr: string, _q, d?: string, s?: string, u?: string) =>
    isDangerousUrl(d ?? s ?? u ?? "") ? `${sep}${attr}="#"` : m,
  );
  // Legacy IE CSS script hooks.
  out = out.replace(/expression\s*\(/gi, "(").replace(/-moz-binding\s*:/gi, "x:").replace(/behavior\s*:/gi, "x:");
  out = out.replace(/url\(\s*(['"]?)\s*(javascript|vbscript):/gi, "url($1#");
  return out;
}

export function sanitizeEmailHtml(html: string): string {
  let out = html;
  for (let i = 0; i < 5; i++) {
    const next = once(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Rough plain-text version of an HTML email (for the text/plain part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
