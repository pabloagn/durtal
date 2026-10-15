import type { Metadata } from "next";
import {
  RouteFallback,
  routeFallbackActionClass,
} from "@/components/shared/route-fallback";

export const metadata: Metadata = { title: "eBook not found" };

export default function ReaderNotFound() {
  return (
    <main>
      <RouteFallback
        title="eBook not found"
        description="This eBook does not exist or is no longer available."
      >
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- The standalone reader fallback returns through a fresh catalogue document. */}
        <a href="/ebooks" className={routeFallbackActionClass}>
          Back to eBooks
        </a>
      </RouteFallback>
    </main>
  );
}
