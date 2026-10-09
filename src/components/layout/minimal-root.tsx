import type { ReactNode } from "react";
import type { Metadata } from "next";
import { rootFontClassName } from "@/styles/root-fonts";
import "@/styles/globals.css";

export const documentMetadata: Metadata = {
  title: {
    default: "Durtal",
    template: "%s | Durtal",
  },
  description: "Personal book catalogue and library index",
};

/** A complete document that needs neither catalogue data nor browser storage. */
export function MinimalRoot({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${rootFontClassName}`}>
      <body>{children}</body>
    </html>
  );
}
