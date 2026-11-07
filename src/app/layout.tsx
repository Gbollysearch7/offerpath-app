import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import { A11yRuntime } from "@/components/A11yRuntime";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Offerpath", template: "%s · Offerpath" },
  description: "From first draft to signed offer. CV reviews, job tailoring and cover letters for UK students.",
  openGraph: { siteName: "Offerpath", locale: "en_GB", type: "website" },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the nonce makes every page render per request, so each gets the nonce its scripts need.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const plausible = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  return (
    <html lang="en-GB">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <A11yRuntime />
        {plausible && <Script src="https://plausible.io/js/script.js" data-domain={plausible} strategy="afterInteractive" nonce={nonce} />}
      </body>
    </html>
  );
}
