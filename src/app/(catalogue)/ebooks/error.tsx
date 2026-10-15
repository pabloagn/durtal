"use client";

import { ListSectionError } from "@/components/shared/section-error";

export default function EbooksError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ListSectionError
      {...props}
      basePath="/ebooks"
      listDescription="eBooks could not be loaded."
      recordDescription="This eBook could not be loaded."
      backLabel="Back to eBooks"
      pages={["highlights", "review", "runs", "upload", "offline"]}
    />
  );
}
