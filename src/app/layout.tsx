import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/layout/shell";
import { ImageGuard } from "@/components/shared/image-guard";
import { TooltipLayer } from "@/components/ui/tooltip";
import "@/styles/globals.css";
import { getImageAdjustmentStyles } from "@/lib/actions/image-adjustments";
import { ImageAdjustmentProvider } from "@/components/media/image-adjustment-provider";
import { cookies } from "next/headers";
import { PreferencesProvider } from "@/lib/hooks/use-preference";
import { PREFERENCE_COOKIE_PREFIX } from "@/lib/utils/preference-cookies";
import { getAppSettings } from "@/lib/actions/settings";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

const serif = localFont({
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
  const [adjustments, settings] = await Promise.all([
    getImageAdjustmentStyles(),
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
      className={`dark ${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <ImageGuard />
        <TooltipLayer />
        <AppSettingsProvider settings={settings}><PreferencesProvider initial={preferences}><ImageAdjustmentProvider initial={adjustments}><Shell>{children}</Shell></ImageAdjustmentProvider></PreferencesProvider></AppSettingsProvider>
      </body>
    </html>
  );
}
