import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const space = Space_Grotesk({ variable: "--font-space", subsets: ["latin"], display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Adrenaline Rush", template: "%s · Adrenaline Rush" },
  description: "Career-focused technology training programs, demos and cohorts.",
  applicationName: "Adrenaline Rush",
  openGraph: { type: "website", siteName: "Adrenaline Rush" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#032d60",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${space.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
