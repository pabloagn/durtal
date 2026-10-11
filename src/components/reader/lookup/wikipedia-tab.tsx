import type { lookupWikipedia } from "@/lib/reader/lookup/wikipedia";
import { LookupAttribution, LookupHtml, LookupSkeleton } from "./lookup-html";
export type WikipediaState = { value: Awaited<ReturnType<typeof lookupWikipedia>> | null; pending: boolean; offline: boolean };
export function WikipediaTab({ state, word }: { state: WikipediaState; word: string }) {
  if (state.offline) return <p className="text-fg-secondary">No connection</p>;
  if (state.pending) return <LookupSkeleton />;
  const result = state.value;
  if (!result?.found) return <p className="text-fg-secondary">{result?.error ? "No connection" : "No Wikipedia article for ‘" + word + "’."}</p>;
  return <section dir={result.dir}>
    {result.fromEnglish && <p className="type-caption mb-2 text-fg-secondary">From English Wikipedia</p>}
    <LookupHtml html={result.title} base={result.article} className="mb-2 font-medium" />
    {result.description && <p className="mb-3 text-fg-secondary">{result.description}</p>}
    <LookupHtml html={result.extract} base={result.article} />
    <LookupAttribution wiki="Wikipedia" href={result.article} label="Read the article" />
  </section>;
}
