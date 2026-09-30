import { isNotNull } from "drizzle-orm";
import { publishingHouses } from "@/lib/db/schema/publishing-houses";

/** Only organizations with a book profile appear in legacy publisher APIs. */
export const publisherCondition = isNotNull(publishingHouses.kind);
