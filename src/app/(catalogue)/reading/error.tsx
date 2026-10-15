"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function ReadingError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/reading"
      listDescription="Reading could not be loaded."
      backLabel="Back to reading"
    />
  );
}
