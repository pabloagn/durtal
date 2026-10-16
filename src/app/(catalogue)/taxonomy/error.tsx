"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function TaxonomyError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/taxonomy"
      listDescription="Taxonomy could not be loaded."
      recordDescription="This family could not be loaded."
      backLabel="Back to taxonomy"
    />
  );
}
