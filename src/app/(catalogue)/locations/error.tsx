"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function LocationsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/locations"
      listDescription="Locations could not be loaded."
      backLabel="Back to locations"
    />
  );
}
