import { z } from "zod";
import { languageName } from "@/lib/utils/language";
import { LOOKUP_LIMITS } from "./policy";
import {
  hasLookupText,
  lookupHtmlDocument,
  sanitizeLookupHtml,
} from "./sanitize";

const definition = z.object({
  definition: z.string(),
  examples: z.array(z.string()).max(10).optional(),
});
const group = z.object({
  partOfSpeech: z.string(),
  language: z.string(),
  definitions: z.array(definition).max(200),
});
const definitions = z.record(z.string(), z.array(group).max(50));
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** Decoded JSON also has a bound, independent of the later fetch stream limit. */
function boundedResponse(body: unknown, maximum: number) {
  let remaining = maximum,
    nodes = 0;
  const ancestors = new Set<object>();
  const text = (value: string) => {
    if (value.length > remaining)
      throw new Error("The lookup response is too large");
    remaining -= bytes(value);
    if (remaining < 0) throw new Error("The lookup response is too large");
  };
  function visit(value: unknown, depth: number) {
    if (++nodes > 20000 || depth > 32)
      throw new Error("The lookup response is too complex");
    if (typeof value === "string") {
      text(value);
      return;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value !== "object" || ancestors.has(value))
      throw new Error("Invalid lookup JSON response");
    ancestors.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new Error("Invalid lookup JSON response");
      for (const key in value)
        if (Object.hasOwn(value, key)) {
          text(key);
          visit((value as Record<string, unknown>)[key], depth + 1);
        }
    }
    ancestors.delete(value);
  }
  visit(body, 0);
}

/** REST-definition model only. Fetching, fallbacks, cache and UI belong to later integration. */
export function wiktionaryDefinitionResponse(body: unknown, language: string) {
  boundedResponse(body, LOOKUP_LIMITS.responseBytes);
  if (!/^[a-z]{2,3}$/.test(language))
    throw new Error("Invalid lookup language");
  const parsed = definitions.parse(body);
  const found = !!parsed[language]?.some(
    (section) => section.definitions.length > 0,
  );
  const selected = found
    ? [[language, parsed[language]] as const]
    : Object.entries(parsed);
  let remaining = LOOKUP_LIMITS.sectionBytes as number;
  const sections = selected.slice(0, 50).flatMap(([code, groups]) =>
    groups
      .slice(0, 50)
      .map((section) => ({
        code,
        language: (languageName(code) ?? section.language).slice(0, 128),
        partOfSpeech: section.partOfSpeech.slice(0, 128),
        definitions: section.definitions.slice(0, 200).flatMap((entry) => {
          if (!remaining) return [];
          const html = sanitizeLookupHtml(entry.definition, {
            base: "https://en.wiktionary.org/wiki/",
            maxBytes: remaining,
          });
          remaining -= bytes(html);
          const examples = (entry.examples ?? [])
            .slice(0, 10)
            .map((example) => {
              const cleaned = sanitizeLookupHtml(example, {
                base: "https://en.wiktionary.org/wiki/",
                maxBytes: remaining,
              });
              remaining -= bytes(cleaned);
              return cleaned;
            })
            .filter(hasLookupText);
          return hasLookupText(html) || examples.length
            ? [{ html, examples }]
            : [];
        }),
      }))
      .filter((section) => section.definitions.length > 0),
  );
  return {
    found: found && sections.some((section) => section.code === language),
    sections,
  };
}

/** Select a whole h2 language section, including current Wikimedia heading wrappers. */
export function wiktionaryParseResponse(
  body: unknown,
  input: { language: string; wikiLanguage: string; base: string },
) {
  boundedResponse(body, LOOKUP_LIMITS.parseResponseBytes);
  if (
    !/^[a-z]{2,3}$/.test(input.language) ||
    !/^[a-z]{2,3}$/.test(input.wikiLanguage)
  )
    throw new Error("Invalid lookup language");
  const parsed = z
    .object({ parse: z.object({ text: z.string() }) })
    .parse(body);
  const template = lookupHtmlDocument(parsed.parse.text);
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames([input.wikiLanguage], { type: "language" }).of(
      input.language,
    );
  } catch {
    name = undefined;
  }
  name ??= languageName(input.language) ?? input.language;
  const wanted = name.normalize("NFC").toLocaleLowerCase(input.wikiLanguage);
  const segmenter = new Intl.Segmenter(input.wikiLanguage, {
    granularity: "word",
  });
  const wordsOf = (value: string) =>
    [...segmenter.segment(value)]
      .filter((word) => word.isWordLike)
      .map((word) => word.segment);
  const languageWords = wordsOf(wanted);
  const headings = [...template.content.querySelectorAll("h2")];
  const at = headings.findIndex((heading) => {
    const label = heading.cloneNode(true) as Element;
    label
      .querySelectorAll(".mw-editsection")
      .forEach((element) => element.remove());
    const text = (label.textContent ?? "")
      .normalize("NFC")
      .toLocaleLowerCase(input.wikiLanguage);
    const words = wordsOf(text);
    return (
      languageWords.length > 0 &&
      words.length === languageWords.length &&
      languageWords.every((word, i) => words[i] === word)
    );
  });
  if (at < 0) return { found: false, html: "" };
  const boundary = (heading: Element) =>
    heading.parentElement?.classList.contains("mw-heading")
      ? heading.parentElement
      : heading;
  const range = template.ownerDocument.createRange();
  range.setStartAfter(boundary(headings[at]));
  if (headings[at + 1]) range.setEndBefore(boundary(headings[at + 1]));
  else range.setEnd(template.content, template.content.childNodes.length);
  const content = range.cloneContents();
  content
    .querySelectorAll(
      "table,img,audio,video,sup.reference,.references,.reflist,.navbox,.noprint",
    )
    .forEach((element) => element.remove());
  const holder = template.ownerDocument.createElement("template");
  holder.content.append(content);
  const html = sanitizeLookupHtml(holder.innerHTML, { base: input.base });
  return { found: hasLookupText(html), html };
}

const summary = z.object({
  titles: z.object({ display: z.string() }),
  description: z.string().optional(),
  extract_html: z.string().optional(),
  extract: z.string().optional(),
  dir: z.enum(["ltr", "rtl"]).optional(),
  type: z.string().optional(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }),
});

export function wikipediaSummaryResponse(body: unknown, base: string) {
  boundedResponse(body, LOOKUP_LIMITS.responseBytes);
  const parsed = summary.parse(body);
  const article = new URL(parsed.content_urls.desktop.page);
  const source = new URL(base);
  if (
    article.protocol !== "https:" ||
    article.hostname !== source.hostname ||
    !/^[a-z]{2,3}\.wikipedia\.org$/.test(article.hostname) ||
    article.username ||
    article.password
  )
    throw new Error("Invalid Wikipedia article address");
  const title = sanitizeLookupHtml(parsed.titles.display, {
    base,
    maxBytes: 1024,
  });
  const description = (parsed.description ?? "").slice(0, 1000);
  const extract = sanitizeLookupHtml(
    parsed.extract_html ??
      parsed.extract?.replace(
        /[&<>]/g,
        (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!,
      ) ??
      "",
    { base },
  );
  return {
    title,
    description,
    extract,
    dir: parsed.dir ?? "ltr",
    disambiguation: parsed.type === "disambiguation",
    article: article.href,
    found: hasLookupText(extract),
  };
}
