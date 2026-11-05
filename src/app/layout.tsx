import { Kanit, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { IS_LIVE } from "@/lib/config";

const kanit = Kanit({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--font-kanit", display: "swap" });
const plex = IBM_Plex_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600"], variable: "--font-plex-thai", display: "swap" });

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: { default: t.app.name, template: `%s · ${t.app.name}` }, description: t.app.tagline };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <html lang={locale} className={`${kanit.variable} ${plex.variable}`}>
      <body className="min-h-screen">
        <I18nProvider locale={locale} live={IS_LIVE}>{children}</I18nProvider>
      </body>
    </html>
  );
}
