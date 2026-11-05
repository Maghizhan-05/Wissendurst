import type { Metadata } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { SITE } from "@/lib/constants";
import { siteUrl } from "@/lib/utils";
import { getAppearance } from "@/lib/data/settings";
import { appearanceCss } from "@/lib/content/appearance";
import { getEventCategories } from "@/lib/data/event-categories";
import { CategoriesProvider } from "@/components/events/categories-context";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});
const mono = JetBrains_Mono({ variable: "--font-mono-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  keywords: [
    "Wissendurst",
    "medical symposium",
    "medical college event",
    "workshops",
    "paper presentation",
    "poster presentation",
    "medical debate",
  ],
  openGraph: {
    type: "website",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    siteName: SITE.name,
    url: siteUrl(),
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Admin colour overrides, validated to #rrggbb tokens only, emitted in <head>
  // so the first paint already uses them (no theme flash).
  const [appearance, categories] = await Promise.all([getAppearance(), getEventCategories()]);
  const themeCss = appearanceCss(appearance);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} ${mono.variable} h-full`}
    >
      {themeCss && (
        <head>
          <style id="site-appearance" dangerouslySetInnerHTML={{ __html: themeCss }} />
        </head>
      )}
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <CategoriesProvider categories={categories}>{children}</CategoriesProvider>
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "var(--surface)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
