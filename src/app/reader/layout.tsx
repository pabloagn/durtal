import type { ReactNode } from "react";
import { MinimalRoot, documentMetadata } from "@/components/layout/minimal-root";

export const metadata = documentMetadata;

/** A document foundation only. Online data belongs to the dynamic page. */
export default function ReaderRootLayout({ children }: { children: ReactNode }) {
  return <MinimalRoot>{children}</MinimalRoot>;
}
