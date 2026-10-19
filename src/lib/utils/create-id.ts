import { readerUuid } from "@/lib/reader/uuid";

/**
 * The id a create dialog makes when it opens and sends with its save, so a
 * resend or a second press after a lost answer saves once (SLN-1276). A UUID
 * v4 even off a secure context, as Durtal is often reached over plain http.
 */
export const createId = readerUuid;
