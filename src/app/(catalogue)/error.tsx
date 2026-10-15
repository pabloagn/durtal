"use client";

import { SectionError } from "@/components/shared/section-error";

/** Any page without its own error view: try again, or go to the dashboard */
export default function CatalogueError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError {...props} backHref="/" backLabel="Go to the dashboard" />;
}
