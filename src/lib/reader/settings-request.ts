import "server-only";
import { cache } from "react";
import { getPersistedReaderSettings } from "@/lib/actions/settings";

/** Shared with the actual SLN-553 runtime loader in the same server request. */
export const readReaderSettings = cache(getPersistedReaderSettings);
