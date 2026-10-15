"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function PublishersError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/publishers"
      listDescription="Publishers could not be loaded."
      recordDescription="This publisher could not be loaded."
      backLabel="Back to publishers"
      pages={["new", "review"]}
    />
  );
}
