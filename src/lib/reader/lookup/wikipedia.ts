import { LOOKUP_LIMITS, wikimediaTitle, wikimediaUrl } from "./policy";
import { operationSignal } from "./resources";
import { wikipediaSummaryResponse } from "./responses";
import { wikimedia, WikimediaClient } from "./wikimedia";

export async function lookupWikipedia(
  language: string,
  word: string,
  parent?: AbortSignal,
  client: WikimediaClient = wikimedia,
) {
  if (!/^[a-z]{2,3}$/.test(language) || !word || word.length > 4096)
    throw new Error("Invalid Wikipedia lookup");
  const scope = operationSignal(parent, LOOKUP_LIMITS.lookupTimeoutMs);
  let failure: unknown;
  try {
    for (const code of language === "en" ? ["en"] : [language, "en"]) {
      try {
        const base = wikimediaUrl(
          "wikipedia",
          code,
          `/wiki/${wikimediaTitle(word)}`,
        );
        const result = wikipediaSummaryResponse(
          await client.json(
            wikimediaUrl(
              "wikipedia",
              code,
              `/api/rest_v1/page/summary/${wikimediaTitle(word)}`,
            ),
            scope.signal,
          ),
          base,
        );
        if (result.found)
          return {
            language: code,
            fromEnglish: code === "en" && language !== "en",
            ...result,
          };
      } catch (error) {
        scope.signal.throwIfAborted();
        failure = error;
      }
    }
    return { found: false as const, error: failure ?? null };
  } finally {
    scope.dispose();
  }
}
