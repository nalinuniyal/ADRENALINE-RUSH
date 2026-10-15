import "server-only";
import QRCode from "qrcode";

/**
 * Renders text (a upi:// link) as a QR code SVG on the server. Medium error
 * correction and a 4-module quiet zone scan reliably from a phone screen.
 */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#ffffff" } });
}

/** The SVG as a data: URL for an <img> (no inline markup in the page). */
export async function qrDataUrl(text: string): Promise<string> {
  const svg = await qrSvg(text);
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
