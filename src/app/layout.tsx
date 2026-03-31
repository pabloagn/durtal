import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/layout/shell";
import { ImageGuard } from "@/components/shared/image-guard";
import "@/styles/globals.css";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <ImageGuard />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
