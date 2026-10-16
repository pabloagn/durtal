"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function OrganizationsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/organizations"
      listDescription="Organizations could not be loaded."
      recordDescription="This organization could not be loaded."
      backLabel="Back to organizations"
    />
  );
}
