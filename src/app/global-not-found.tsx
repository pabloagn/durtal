import type { Metadata } from "next";
import { MinimalRoot } from "@/components/layout/minimal-root";
import {
  RouteFallback,
  routeFallbackActionClass,
} from "@/components/shared/route-fallback";

export const metadata: Metadata = {
  title: "Page not found | Durtal",
  robots: { index: false, follow: false },
};

/** Unmatched addresses bypass every data-loaded root layout. */
export default function GlobalNotFound() {
  return (
    <MinimalRoot>
      <main>
        <RouteFallback
          title="Page not found"
          description="The page you are looking for does not exist or has been moved."
        >
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- This independent fallback returns to the catalogue with a fresh document. */}
          <a href="/" className={routeFallbackActionClass}>
            Go to dashboard
          </a>
        </RouteFallback>
      </main>
    </MinimalRoot>
  );
}
