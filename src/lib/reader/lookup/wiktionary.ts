import { LOOKUP_LIMITS, wikimediaTitle, wikimediaUrl } from "./policy";
import { operationSignal } from "./resources";
import {
  wiktionaryDefinitionResponse,
  wiktionaryParseResponse,
} from "./responses";
import { wikimedia, WikimediaClient, WikimediaError } from "./wikimedia";

function parseAddress(language: string, word: string) {
  const query = new URLSearchParams({
    action: "parse",
    format: "json",
    formatversion: "2",
    origin: "*",
    redirects: "1",
    prop: "text",
    disableeditsection: "1",
    disabletoc: "1",
    page: word,
  });
  return wikimediaUrl("wiktionary", language, `/w/api.php?${query}`);
}
function missingPage(body: unknown) {
  return (
    !!body &&
    typeof body === "object" &&
    "error" in body &&
    !!body.error &&
    typeof body.error === "object" &&
    "code" in body.error &&
    body.error.code === "missingtitle"
  );
}
async function ownEntry(
  client: WikimediaClient,
  language: string,
  words: readonly string[],
  signal: AbortSignal,
) {
  for (const word of words) {
    let body: unknown;
    try {
      body = await client.json(
        parseAddress(language, word),
        signal,
        LOOKUP_LIMITS.parseResponseBytes,
      );
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof WikimediaError && error.status === 404) continue;
      throw error;
    }
    if (missingPage(body)) continue;
    const result = wiktionaryParseResponse(body, {
      language,
      wikiLanguage: language,
      base: wikimediaUrl(
        "wiktionary",
        language,
        `/wiki/${wikimediaTitle(word)}`,
      ),
    });
    if (result.found) return { word, ...result };
  }
  return { word: words[0], found: false, html: "" };
}
async function englishEntry(
  client: WikimediaClient,
  language: string,
  words: readonly string[],
  signal: AbortSignal,
) {
  let fallbackUsed = false;
  let other: ReturnType<typeof wiktionaryDefinitionResponse> | null = null;
  for (const word of words) {
    try {
      const body = await client.json(
        wikimediaUrl(
          "wiktionary",
          "en",
          `/api/rest_v1/page/definition/${wikimediaTitle(word)}`,
        ),
        signal,
      );
      const result = wiktionaryDefinitionResponse(body, language);
      if (result.found)
        return { word, format: "definitions" as const, ...result };
      if (result.sections.length) other ??= result;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof WikimediaError && error.status === 404) continue;
      if (fallbackUsed) throw error;
      fallbackUsed = true;
      const body = await client.json(
        parseAddress("en", word),
        signal,
        LOOKUP_LIMITS.parseResponseBytes,
      );
      if (missingPage(body)) continue;
      const result = wiktionaryParseResponse(body, {
        language,
        wikiLanguage: "en",
        base: wikimediaUrl("wiktionary", "en", `/wiki/${wikimediaTitle(word)}`),
      });
      if (result.found) return { word, format: "html" as const, ...result };
    }
  }
  return {
    word: words[0],
    format: "definitions" as const,
    found: false,
    sections: other?.sections ?? [],
  };
}

/** Both dictionary sections acquire in parallel; a section failure leaves the other usable. */
export async function lookupWiktionary(
  language: string,
  words: readonly string[],
  parent?: AbortSignal,
  client: WikimediaClient = wikimedia,
  updates?: {
    english?: (
      result: PromiseSettledResult<Awaited<ReturnType<typeof englishEntry>>>,
    ) => void;
    own?: (
      result: PromiseSettledResult<Awaited<ReturnType<typeof ownEntry>> | null>,
    ) => void;
  },
) {
  if (
    !/^[a-z]{2,3}$/.test(language) ||
    words.length < 1 ||
    words.length > 2 ||
    words.some((word) => !word || word.length > 4096)
  )
    throw new Error("Invalid Wiktionary lookup");
  const scope = operationSignal(parent, LOOKUP_LIMITS.lookupTimeoutMs);
  const publish = <T>(
    task: Promise<T>,
    callback: ((result: PromiseSettledResult<T>) => void) | undefined,
  ) =>
    task.then(
      (value) => {
        if (!scope.signal.aborted) callback?.({ status: "fulfilled", value });
        return value;
      },
      (reason: unknown) => {
        if (!scope.signal.aborted) callback?.({ status: "rejected", reason });
        throw reason;
      },
    );
  try {
    const [english, own] = await Promise.allSettled([
      publish(
        englishEntry(client, language, words, scope.signal),
        updates?.english,
      ),
      publish(
        /^(es|fr|de|it)$/.test(language)
          ? ownEntry(client, language, words, scope.signal)
          : Promise.resolve(null),
        updates?.own,
      ),
    ]);
    scope.signal.throwIfAborted();
    return { english, own };
  } finally {
    scope.dispose();
  }
}
