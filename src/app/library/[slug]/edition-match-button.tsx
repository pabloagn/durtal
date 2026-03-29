"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MatchAgainDialog } from "@/components/books/match-again-dialog";

interface EditionMatchButtonProps {
  workId: string;
  editionId: string;
  currentTitle: string;
  currentAuthor: string;
  currentMetadataSource?: string | null;
}

export function EditionMatchButton({
  workId,
  editionId,
  currentTitle,
  currentAuthor,
  currentMetadataSource,
}: EditionMatchButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Match again"
      >
        <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        Match
      </Button>

      <MatchAgainDialog
        open={open}
        onClose={() => setOpen(false)}
        workId={workId}
        editionId={editionId}
        currentTitle={currentTitle}
        currentAuthor={currentAuthor}
        currentMetadataSource={currentMetadataSource}
      />
    </>
  );
}
