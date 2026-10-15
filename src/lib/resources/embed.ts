/**
 * Video embeds for public resource pages. Only a small allowlist of hosts is
 * ever embedded (YouTube, Vimeo, Google Drive files, Loom); every other link
 * is shown as a button instead. Pure and isomorphic.
 */

export type EmbedProvider = "youtube" | "vimeo" | "drive" | "loom";

export type Embed = { provider: EmbedProvider; src: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const LOOM_ID = /^[a-f0-9]{32}$/i;

function parse(url: string): URL | null {
  if (typeof url !== "string" || !URL.canParse(url.trim())) return null;
  const u = new URL(url.trim());
  return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") ? u : null;
}

/** Start time from t=90, t=1m30s or start=90, in whole seconds. */
function startSeconds(u: URL): number | null {
  const raw = u.searchParams.get("t") ?? u.searchParams.get("start");
  if (!raw) return null;
  if (/^\d+s?$/.test(raw)) return Number.parseInt(raw, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return parts[0] ?? null;
  if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host)) return null;
  if (parts[0] === "watch") return u.searchParams.get("v");
  if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) return parts[1] ?? null;
  return null;
}

/** Embeddable player URL for a supported video link, or null to show a plain link. */
export function embedFor(url: string | null | undefined): Embed | null {
  const u = parse(url ?? "");
  if (!u) return null;
  const host = u.hostname.toLowerCase();

  const yt = youtubeId(u);
  if (yt !== null) {
    if (!YT_ID.test(yt)) return null;
    const start = startSeconds(u);
    return { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${yt}${start ? `?start=${start}` : ""}` };
  }

  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = host === "player.vimeo.com" ? (parts[0] === "video" ? 1 : -1) : parts.findIndex((p) => /^\d+$/.test(p));
    const id = idx >= 0 ? parts[idx] : undefined;
    if (!id || !/^\d{1,12}$/.test(id)) return null;
    // Unlisted videos carry a privacy hash: vimeo.com/123/abcdef or ?h=abcdef.
    const next = parts[idx + 1];
    const hash = u.searchParams.get("h") ?? (host !== "player.vimeo.com" && next && /^[a-f0-9]{6,20}$/i.test(next) ? next : null);
    return { provider: "vimeo", src: `https://player.vimeo.com/video/${id}${hash && /^[a-f0-9]{6,20}$/i.test(hash) ? `?h=${hash}` : ""}` };
  }

  if (host === "drive.google.com") {
    const m = /^\/file\/d\/([^/]+)/.exec(u.pathname);
    const id = m?.[1] ?? (u.pathname === "/open" ? u.searchParams.get("id") : null);
    if (!id || !DRIVE_ID.test(id)) return null;
    return { provider: "drive", src: `https://drive.google.com/file/d/${id}/preview` };
  }

  if (host === "www.loom.com" || host === "loom.com") {
    const m = /^\/(?:share|embed)\/([^/]+)/.exec(u.pathname);
    if (!m || !LOOM_ID.test(m[1])) return null;
    return { provider: "loom", src: `https://www.loom.com/embed/${m[1]}` };
  }

  return null;
}

/** Short host label for link buttons ("youtube.com", "drive.google.com"), or null. */
export function linkHost(url: string | null | undefined): string | null {
  const u = parse(url ?? "");
  return u ? u.hostname.replace(/^www\./i, "").toLowerCase() : null;
}

/** YouTube thumbnail for a video link when no thumbnail was set. */
export function autoThumbnail(url: string | null | undefined): string | null {
  const u = parse(url ?? "");
  const id = u ? youtubeId(u) : null;
  return id && YT_ID.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
