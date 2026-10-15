"use client";

import { SectionError } from "@/components/shared/section-error";

export default function HarmonizeError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SectionError
      {...props}
      description="The catalogue scan was interrupted. Your records are unchanged: try again when the connection is back."
      backHref="/"
      backLabel="Go to the dashboard"
    />
  );
}
