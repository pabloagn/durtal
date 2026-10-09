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
        <a href="/library" className={routeFallbackActionClass}>
          Back to library
        </a>
      </RouteFallback>
    </main>
  );
}
