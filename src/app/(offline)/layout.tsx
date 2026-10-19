import type { ReactNode } from "react";
import { MinimalRoot, documentMetadata } from "@/components/layout/minimal-root";

export const metadata = documentMetadata;

/** A document foundation for the downloaded-books shells: the app's styles, no online data. */
export default function OfflineRootLayout({ children }: { children: ReactNode }) {
  return <MinimalRoot>{children}</MinimalRoot>;
}
