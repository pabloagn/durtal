import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { LookupSettings } from "@/lib/validations/reader-lookup";
import { lookupSourceUrl, sourcesForLanguage } from "@/lib/reader/lookup/sources";
import { languageName } from "@/lib/utils/language";
export function SourcesTab({ settings, language, word }: { settings: LookupSettings; language: string; word: string }) {
  const sources = sourcesForLanguage(settings.sources, language);
  return sources.length ? <ul>{sources.map((source, index) => {
    const href = lookupSourceUrl(source, word);
    return <li key={index}><a href={href} target="_blank" rel="noopener noreferrer"
      className="flex min-h-8 items-start justify-between gap-3 py-2 pointer-coarse:min-h-11">
      <span><span className="block">{source.name}</span><span className="text-xs text-fg-secondary">{new URL(href).host}</span></span>
      <ExternalLink aria-hidden className="mt-1 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
    </a></li>;
  })}</ul> : <p className="text-fg-secondary">No sources for {languageName(language)}. <Link className="underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center" href="/settings/reader#lookup-sources">Add one in Settings › Reader</Link></p>;
}
