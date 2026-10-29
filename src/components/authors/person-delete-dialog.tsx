"use client";

import { useEffect, useState } from "react";
import { DeleteConfirmDialog } from "@/app/(catalogue)/library/[slug]/delete-confirm-dialog";
import { getPersonDeletionRefusal } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

/** Mounted afresh for each opening: stale card counts never enable deletion. */
export function PersonDeleteDialog({ authorId, name, onClose, onConfirm }: {
  authorId: string;
  name: string;
  onClose(): void;
  onConfirm(): Promise<void>;
}) {
  const [refusal, setRefusal] = useState<string | null>("Checking their credits…");
  useEffect(() => {
    let active = true;
    getPersonDeletionRefusal(authorId).then(
      value => { if (active) setRefusal(value); },
      error => { if (active) setRefusal(refusalMessage(error, "Could not check their credits. Close this dialog and try again.")); },
    );
    return () => { active = false; };
  }, [authorId]);
  return <DeleteConfirmDialog open onClose={onClose} onConfirm={onConfirm}
    title="Delete person" description="This cannot be undone." itemName={name}
    refusal={refusal} hideConfirmOnRefusal
    cascade="Their books and editions stay in your library; their credits will be removed." />;
}
