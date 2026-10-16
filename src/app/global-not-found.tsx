import type { Metadata } from "next";
import { MinimalRoot } from "@/components/layout/minimal-root";
import { RouteFallback } from "@/components/shared/route-fallback";
import { buttonClass } from "@/components/ui/button";

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
          {/* Worded and drawn as the app's own not-found view's way back (SLN-814) */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- This independent fallback returns to the catalogue with a fresh document. */}
          <a href="/" className={buttonClass("secondary")}>
            Go to the dashboard
          </a>
        </RouteFallback>
      </main>
    </MinimalRoot>
  );
}
