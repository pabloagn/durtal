"use client";

import { ListSectionError } from "@/components/shared/section-error";

// Inside the settings layout, so a failed settings page keeps the title and
// the settings list beside it, and leads back to General (SLN-754)
export default function SettingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      heading="h2"
      basePath="/settings"
      listDescription="Settings could not be loaded."
      backLabel="Back to settings"
    />
  );
}
