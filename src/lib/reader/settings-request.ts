import "server-only";
import { cache } from "react";
import { getPersistedReaderSettings } from "@/lib/actions/settings";

/** Shared by the runtime and tracker loaders within one server request. */
export const readReaderSettings = cache(getPersistedReaderSettings);
