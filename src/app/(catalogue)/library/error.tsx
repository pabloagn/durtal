"use client";

import { usePathname } from "next/navigation";
import { DomainError, isRecordPath } from "@/components/domains/domain-states";
import { SectionError } from "@/components/shared/section-error";

export default function LibraryError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  // A book whose layout check failed says so, as its own error view does
  if (isRecordPath("/library", pathname)) return <DomainError kind="book" record {...props} />;
  return <SectionError {...props} backHref="/library" backLabel="Back to books" />;
}
