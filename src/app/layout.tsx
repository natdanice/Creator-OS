import type { Metadata } from "next";
import { Kanit, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { t } from "@/lib/i18n";

const kanit = Kanit({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--font-kanit", display: "swap" });
const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--font-plex-thai", display: "swap" });

export const metadata: Metadata = {
  title: { default: t.app.name, template: `%s · ${t.app.name}` },
  description: t.app.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${kanit.variable} ${plex.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
