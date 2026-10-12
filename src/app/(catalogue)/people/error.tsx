"use client";

import { SectionError } from "@/components/shared/section-error";

export default function AuthorsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError {...props} backHref="/people" backLabel="Back to people" />;
}
