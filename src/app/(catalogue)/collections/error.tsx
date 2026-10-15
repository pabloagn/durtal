"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function CollectionsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/collections"
      listDescription="Collections could not be loaded."
      recordDescription="This collection could not be loaded."
      backLabel="Back to collections"
    />
  );
}
