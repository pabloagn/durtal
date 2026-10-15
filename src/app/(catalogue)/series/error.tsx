"use client";

import { ListSectionError } from "@/components/shared/section-error";

// A series or Series suggestions that fails leads back to the series, not to
// the dashboard (SLN-754)
export default function SeriesError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/series"
      listDescription="Series could not be loaded."
      recordDescription="This series could not be loaded."
      backLabel="Back to series"
      pages={["suggestions"]}
    />
  );
}
