"use client";

import { Button } from "@/components/ui/button";
import { useReadingDialogs } from "../reading-dialogs-provider";

/** "Read it again": the Start dialog for a book he has read (worth re-reading, SLN-457) */
export function StartAgainButton({ workId, editionId }: { workId: string; editionId: string | null }) {
  const { open } = useReadingDialogs();
  return (
    <Button size="sm" variant="ghost" onClick={() => void open({ kind: "start", workId, editionId })} className="-ml-2 pointer-coarse:h-11" data-reread-start={workId}>
      Read it again
    </Button>
  );
}
