"use client";

import { useEffect } from "react";
import { MoreHorizontal, Replace, Unlink } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useUnlinkEbook } from "./unlink-ebook-button";

/** The linked-book card's quiet menu: "Change the book…" and Unlink live here, behind their confirmation, never as a bare link (SLN-666) */
export function LinkedBookMenu({ ebookId }: { ebookId: string }) {
  const unlink = useUnlinkEbook(ebookId);
  useEffect(() => { if (unlink.error) toast.error(unlink.error); }, [unlink.error]);
  return <>
    <DropdownMenu label="Book actions" align="end" trigger={
      <button type="button" className="action-icon">
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
      </button>
    }>
      {/* Unlinks with the same check, then opens "Choose a book" for its new one */}
      <DropdownMenuItem disabled={unlink.busy} onClick={() => void unlink.open({ change: true })}
        icon={<Replace className="h-4 w-4" strokeWidth={1.5} />}>
        Change the book…
      </DropdownMenuItem>
      <DropdownMenuItem variant="danger" disabled={unlink.busy} onClick={() => void unlink.open()}
        icon={<Unlink className="h-4 w-4" strokeWidth={1.5} />}>
        {unlink.loading ? "Loading link…" : "Unlink from this book…"}
      </DropdownMenuItem>
    </DropdownMenu>
  </>;
}
