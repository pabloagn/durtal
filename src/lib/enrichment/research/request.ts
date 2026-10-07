import { createHash } from "node:crypto";
import { z } from "zod";
import { stableStringify } from "@/lib/harmonization/normalize";
import { EXTRACTION_MODEL } from "./config";
import type { ResearchProfile } from "./profile";
import type { Passage } from "./text";

/*
 * One extraction request (SLN-469, section 3): the book, the research
 * dimensions with their terms (never their example or anchor books, so the
 * model cannot match a title it knows), the passages, the instructions and an
 * output schema of the current terms. Raise PROMPT_VERSION on any change to
 * the template, the passage rules, the checks of section 4 or
 * researchConfidence: SLN-471's guard test relies on it.
 */

export const PROMPT_VERSION = "research-prompt-1";

/** A research dimension as the model sees it */
export interface ExtractDimension {
  key: string;
  label: string;
  definition: string;
  valueKind: "term" | "terms" | "scale";
  terms: { key: string; label: string; definition: string; appliesWhen: string; doesNotApplyWhen: string; scaleValue: number | null }[];
  /** Term keys that exclude each other (the seed's exclusiveTerms) */
  exclusive: string[][];
}

const INSTRUCTIONS = `You read passages of one stored document (a review, an essay or a publisher's page) about one book, and you tag the book with the terms of a fixed vocabulary.

Rules:
- Use only the passages. Ignore anything you know about the book, its author or its reputation.
- Give a term only when a passage says it of this book: the book named below, not another book the document mentions.
- For every term you give, copy an excerpt from one passage exactly, character for character, and name that passage's id. Do not shorten, join or change the excerpt in any way, and do not use "..." to skip text.
- Each excerpt says why the term applies, in the document's own words.
- When nothing in the passages fits a dimension, give an empty list for it.
- A dimension with one value per book still answers with a list: give every term a passage supports.`;

/** The vocabulary, as the instructions' second part: definitions and rules, never examples */
function vocabularyText(dimensions: ExtractDimension[]) {
  return dimensions
    .map((d) =>
      [
        `## ${d.key}: ${d.label}${d.valueKind === "scale" ? " (a scale: choose the point that fits)" : d.valueKind === "term" ? " (one value per book)" : " (several values allowed)"}`,
        d.definition,
        ...d.terms.map(
          (t) => `- ${t.key} (${t.label}${t.scaleValue !== null ? `, point ${t.scaleValue}` : ""}): ${t.definition} Applies when: ${t.appliesWhen} Does not apply when: ${t.doesNotApplyWhen}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

/** The output schema: per dimension, a list of { term, excerpt, passage }, the term one of its current keys */
export function answerSchema(dimensions: ExtractDimension[]) {
  return z.strictObject(
    Object.fromEntries(
      dimensions.map((d) => [
        d.key,
        z.array(z.strictObject({ term: z.enum(d.terms.map((t) => t.key) as [string, ...string[]]), excerpt: z.string(), passage: z.string() })),
      ]),
    ),
  );
}

/** The body as sent to the Messages API */
export interface ExtractionRequest {
  model: string;
  max_tokens: number;
  system: { type: "text"; text: string; cache_control: { type: "ephemeral" } }[];
  messages: { role: "user"; content: string }[];
  output_config: { effort: string; format: { type: "json_schema"; schema: Record<string, unknown> } };
}

/** One document's request; dimensions without a current term are left out */
export function buildRequest(profile: Pick<ResearchProfile, "titles" | "authors">, dimensions: ExtractDimension[], passages: Passage[]): ExtractionRequest {
  const asked = dimensions.filter((d) => d.terms.length);
  const book = `The book: ${profile.titles.map((t) => `"${t}"`).join(" or ")} by ${profile.authors.map((a) => a.name).join(", ")}.`;
  const text = passages.map((p) => `<passage id="${p.id}">\n${p.text}\n</passage>`).join("\n\n");
  return {
    model: EXTRACTION_MODEL.model,
    max_tokens: EXTRACTION_MODEL.maxOutputTokens,
    // The instructions and the vocabulary first, cached across the documents of a version
    system: [{ type: "text", text: `${INSTRUCTIONS}\n\n# Vocabulary\n\n${vocabularyText(asked)}`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${book}\n\n${text}` }],
    output_config: { effort: EXTRACTION_MODEL.effort, format: { type: "json_schema", schema: z.toJSONSchema(answerSchema(asked)) as Record<string, unknown> } },
  };
}

const sha256 = (value: unknown) => createHash("sha256").update(stableStringify(value)).digest("hex");

/** The SHA-256 of the request as sent: a document already extracted with it is never sent again */
export const requestHash = (request: ExtractionRequest) => sha256(request);

/** What every extraction and its evidence name: the prompt, the pinned model and a hash of the settings */
export const EXTRACTOR_VERSION = `${PROMPT_VERSION} ${EXTRACTION_MODEL.model} ${sha256({
  max_tokens: EXTRACTION_MODEL.maxOutputTokens,
  effort: EXTRACTION_MODEL.effort,
  format: "json_schema",
}).slice(0, 12)}`;
