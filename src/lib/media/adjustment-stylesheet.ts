import { count, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { imageAdjustments } from "@/lib/db/schema";
import { cached, CACHE_TAGS } from "@/lib/cache";

export const IMAGE_ADJUSTMENTS_STYLESHEET = "/api/image-adjustments.css";

/** Changes whenever a row is saved or deleted, so the stylesheet URL can be cached forever. */
export const getImageAdjustmentsVersion = cached(
  async () => {
    const [row] = await db
      .select({ updatedAt: max(imageAdjustments.updatedAt), rows: count() })
      .from(imageAdjustments);
    return `${row?.updatedAt?.getTime() ?? 0}-${row?.rows ?? 0}`;
  },
  ["image-adjustments-version"],
  [CACHE_TAGS.media],
);
