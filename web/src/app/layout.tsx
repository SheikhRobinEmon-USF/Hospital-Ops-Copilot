import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hospital Ops Copilot",
  description:
    "Hospital financial benchmarking on public CMS cost reports, with an evidence-grounded local AI copilot.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14151c" },
    { media: "(prefers-color-scheme: light)", color: "#fafafc" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
