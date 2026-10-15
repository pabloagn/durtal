"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function RecommendersError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/recommenders"
      listDescription="Recommenders could not be loaded."
      recordDescription="This recommender could not be loaded."
      backLabel="Back to recommenders"
    />
  );
}
