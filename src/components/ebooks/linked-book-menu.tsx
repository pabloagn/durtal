"use client";

import { useEffect } from "react";
import { MoreHorizontal, Unlink } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useUnlinkEbook } from "./unlink-ebook-button";

/** The linked-book card's quiet menu: Unlink lives here, behind its confirmation, never as a bare link (SLN-666) */
export function LinkedBookMenu({ ebookId }: { ebookId: string }) {
  const unlink = useUnlinkEbook(ebookId);
  useEffect(() => { if (unlink.error) toast.error(unlink.error); }, [unlink.error]);
  return <>
    <DropdownMenu label="Book actions" align="end" trigger={
      <button type="button" className="action-icon">
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
      </button>
    }>
      <DropdownMenuItem variant="danger" disabled={unlink.busy} onClick={() => void unlink.open()}
        icon={<Unlink className="h-4 w-4" strokeWidth={1.5} />}>
        {unlink.loading ? "Loading link…" : "Unlink from this book…"}
      </DropdownMenuItem>
    </DropdownMenu>
    {unlink.dialog}
  </>;
}
