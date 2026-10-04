import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/layout/shell";
import { ImageGuard } from "@/components/shared/image-guard";
import { TooltipLayer } from "@/components/ui/tooltip";
import "@/styles/globals.css";
import {
  IMAGE_ADJUSTMENTS_STYLESHEET,
  getImageAdjustmentsVersion,
} from "@/lib/media/adjustment-stylesheet";
import { ImageAdjustmentProvider } from "@/components/media/image-adjustment-provider";
import { cookies } from "next/headers";
import { PreferencesProvider } from "@/lib/hooks/use-preference";
import { PREFERENCE_COOKIE_PREFIX } from "@/lib/utils/preference-cookies";
import { getAppSettings } from "@/lib/actions/settings";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

// next/font names the family after this variable. It must not be a generic
// family ("serif"): Safari writes the computed family without quotes, and a
// script that reads it back (a canvas measuring the font) gets Times instead
const cirka = localFont({
  src: [
    {
      path: "../../public/fonts/PPCirka/PPCirka-Light.otf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../public/fonts/PPCirka/PPCirka-Bold.otf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-serif",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Every page shows live catalogue data, so render per request and never at
// build time: a pre-rendered page would show build-time data forever, and the
// build would need database credentials. Reference data stays cached through
// `cached()` (src/lib/cache.ts), which is independent of this setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Durtal",
    template: "%s | Durtal",
  },
  description: "Personal book catalogue and library index",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [adjustmentsVersion, settings] = await Promise.all([
    getImageAdjustmentsVersion(),
    getAppSettings(),
  ]);
  const preferences = Object.fromEntries(
    (await cookies())
      .getAll()
      .filter((cookie) => cookie.name.startsWith(PREFERENCE_COOKIE_PREFIX))
      .map((cookie) => [cookie.name, cookie.value]),
  );
  return (
    <html
      lang="en"
      className={`dark ${cirka.variable} ${sans.variable} ${mono.variable}`}
    >
      <head>
        <link
          rel="stylesheet"
          href={`${IMAGE_ADJUSTMENTS_STYLESHEET}?v=${adjustmentsVersion}`}
        />
      </head>
      <body>
        <ImageGuard />
        <TooltipLayer />
        <AppSettingsProvider settings={settings}><PreferencesProvider initial={preferences}><ImageAdjustmentProvider><Shell>{children}</Shell></ImageAdjustmentProvider></PreferencesProvider></AppSettingsProvider>
      </body>
    </html>
  );
}
