import "server-only";
import { createNarrationRoutes, narrationProviderFromEnv } from "./server";

/** One set of routes per server process: the voice list and audio caches live here */
export const narrationRoutes = createNarrationRoutes(() => narrationProviderFromEnv());
