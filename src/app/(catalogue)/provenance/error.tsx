"use client";

import { SectionError } from "@/components/shared/section-error";

export default function ProvenanceError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError {...props} backHref="/provenance" backLabel="Back to provenance" />;
}
