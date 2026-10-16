"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function PlacesError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/places"
      listDescription="Places could not be loaded."
      recordDescription="This place could not be loaded."
      backLabel="Back to places"
    />
  );
}
