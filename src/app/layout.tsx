import type { Metadata } from "next";
import { EB_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/layout/shell";
import "@/styles/globals.css";

const serif = EB_Garamond({
  subsets: ["latin"],
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
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
