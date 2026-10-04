"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { setFavourites } from "@/lib/actions/favourites";
import type { FavouriteEntity } from "@/lib/constants/favourites";
import { MARKS } from "@/lib/constants/marks";

/**
 * "Mark as favourite" and "Remove favourite" for the selected items of a
 * bulk toolbar. Books take the same actions from their Marks menu.
 */
export function FavouriteBulkMenu({
  entity,
  ids,
  noun,
}: {
  entity: FavouriteEntity;
  ids: Set<string>;
  /** One item and many: ["person", "people"] */
  noun: [string, string];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function apply(favourite: boolean) {
    setPending(true);
    try {
      const { updated } = await setFavourites({
        entity,
        ids: Array.from(ids),
        favourite,
      });
      toast.success(
        updated === 0
          ? `Favourites: no ${noun[1]} changed`
          : `Favourites: ${updated} ${updated === 1 ? noun[0] : noun[1]} ${favourite ? "marked" : "removed"}`,
      );
      router.refresh();
    } catch {
      toast.error("Could not update the favourites. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu
      align="center"
      side="top"
      trigger={
        <Button variant="ghost" size="sm" disabled={pending}>
          <Star className="h-3.5 w-3.5" strokeWidth={1.5} />
          {MARKS.favourite.label}
        </Button>
      }
    >
      <DropdownMenuItem onClick={() => apply(true)} disabled={pending}>
        {MARKS.favourite.markAction}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => apply(false)} disabled={pending}>
        {MARKS.favourite.unmarkAction}
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
