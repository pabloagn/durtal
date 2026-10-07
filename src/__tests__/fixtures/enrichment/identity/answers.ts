import { readFileSync } from "node:fs";
import { SourceCache } from "@/lib/enrichment/source-cache";
import { ANSWER, type WikidataItem } from "@/lib/enrichment/identity";
import { readOpenLibraryEdition, readOpenLibraryWork, readWikidataItem } from "@/lib/enrichment/identity-sources";

/*
 * The identity tests' answers (SLN-464). recorded.json holds answers the
 * read-only SLN-461 sample fetched on 6 Oct 2026. Two kinds were not
 * recorded, and are built here: the reverse P648 lookups (from the recorded
 * items' own P648) and title searches, with made-up item ids above Q90000000.
 */

export const RECORDED = JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/identity/recorded.json", "utf8")).answers as Record<
  string,
  Record<string, unknown>
>;
export const RETRIEVED_AT = new Date("2026-10-06T12:00:00.000Z");

/** Items whose P648 is each Open Library work, as a reverse lookup would answer */
export const LINKED_ITEMS: Record<string, string[]> = {
  OL157104W: ["Q979609"],
  OL28434W: ["Q1428590"],
  OL712025W: [],
  OL32195W: ["Q521688"],
  OL3428975W: ["Q1315145"],
  OL1272992W: [],
  OL1272994W: [],
};

/** A made-up author and the item a title search for "Kaputt" by that author finds */
export const KAPUTT_AUTHOR = "Q90000001";
export const KAPUTT_HIT: WikidataItem = {
  id: "Q90000002",
  label: "Kaputt",
  claims: { P31: ["Q7725634"], P50: [KAPUTT_AUTHOR], P577: ["+1944-00-00T00:00:00Z"], P629: [], P648: [], P5331: [] },
};

/** The cache a run holds after fetching every answer above, plus `extra` */
export function recordedAnswers(extra: Record<string, unknown> = {}) {
  const cache = SourceCache.memory();
  for (const [url, body] of Object.entries(RECORDED)) {
    const isbn = /\/isbn\/(\d+)\.json$/.exec(url)?.[1];
    const work = /\/works\/(OL\d+W)\.json$/.exec(url)?.[1];
    const qid = /\/wiki\/(Q\d+)$/.exec(url)?.[1];
    if (isbn) cache.set(ANSWER.edition(isbn), readOpenLibraryEdition(body), RETRIEVED_AT);
    if (work) cache.set(ANSWER.work(work), readOpenLibraryWork(body), RETRIEVED_AT);
    if (qid) cache.set(ANSWER.item(qid), readWikidataItem(body as Parameters<typeof readWikidataItem>[0]), RETRIEVED_AT);
  }
  for (const [work, qids] of Object.entries(LINKED_ITEMS)) cache.set(ANSWER.linkedItems(work), qids, RETRIEVED_AT);
  cache.set(ANSWER.search("Kaputt", KAPUTT_AUTHOR), [{ id: KAPUTT_HIT.id, label: "Kaputt", aliases: [] }], RETRIEVED_AT);
  cache.set(ANSWER.item(KAPUTT_HIT.id), KAPUTT_HIT, RETRIEVED_AT);
  for (const [key, answer] of Object.entries(extra)) cache.set(key, answer, RETRIEVED_AT);
  return cache;
}
