"use client";

import { SectionError } from "@/components/shared/section-error";

export default function LibraryError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError {...props} backHref="/library" backLabel="Back to books" />;
}
