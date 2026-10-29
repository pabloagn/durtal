import localFont from "next/font/local";
import { Inter, JetBrains_Mono } from "next/font/google";

// Keep the app's existing families and variables in every document root.
// The family must not be named "serif": Safari otherwise measures Cirka
// with the generic fallback when a canvas reads the computed font.
const cirka = localFont({
  src: [
    {
      path: "../../public/fonts/PPCirka/PPCirka-Light.otf",
      weight: "300",
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

export const rootFontClassName = `${cirka.variable} ${sans.variable} ${mono.variable}`;
