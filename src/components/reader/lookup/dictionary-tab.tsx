import Link from "next/link";
import type { lookupWiktionary } from "@/lib/reader/lookup/wiktionary";
import type { PackLookupEntry } from "@/lib/reader/lookup/pack-runtime";
import type { PackRecord } from "@/lib/reader/lookup/pack-store";
import { wikimediaTitle } from "@/lib/reader/lookup/policy";
import { sanitizeXdxf } from "@/lib/reader/lookup/sanitize";
import { languageName } from "@/lib/utils/language";
import { LookupAttribution, LookupHtml, LookupSkeleton, Unreachable } from "./lookup-html";
type Online = Awaited<ReturnType<typeof lookupWiktionary>>;
export type DictionaryState = {
  packs: PackRecord[]; entries: PackLookupEntry[]; packsPending: boolean; packError: string | null;
  english: Online["english"] | null; own: Online["own"] | null; offline: boolean;
};
const ownName: Record<string, string> = { es: "Wikcionario", fr: "Wiktionnaire", de: "Wiktionary (Deutsch)", it: "Wikizionario" };
function packHtml(type: string, text: string): string {
  if (type !== "x") return text;
  try { return sanitizeXdxf(text, { base: "https://en.wiktionary.org/wiki/" }); }
  catch { return "<p>This entry uses a format Durtal does not show</p>"; }
}
export function DictionaryTab({ state, language, word }: { state: DictionaryState; language: string; word: string }) {
  const english = state.english?.status === "fulfilled" ? state.english.value : null;
  const own = state.own?.status === "fulfilled" ? state.own.value : null;
  const base = "https://en.wiktionary.org/wiki/" + wikimediaTitle(english?.word ?? word);
  return <div className="space-y-5">
    <section><h3 className="type-caption mb-2">Packs on this device</h3>
      {state.packsPending ? <LookupSkeleton /> : state.entries.length ? state.entries.map((entry, index) =>
        <div key={entry.packId + ":" + index} className="mb-4">
          <p className="type-caption text-fg-secondary">{state.packs.find(pack => pack.id === entry.packId)?.name}</p>
          <p className="mb-2 font-medium">{entry.headword}</p>
          {entry.parts.length ? entry.parts.map((part, index) =>
            part.type === "h" || part.type === "g" || part.type === "x"
              ? <LookupHtml key={index} html={packHtml(part.type, part.text)} base="https://en.wiktionary.org/wiki/" />
              : <p key={index} className={part.type === "t" ? "mb-2 italic text-fg-secondary" : "mb-2 whitespace-pre-wrap"}>{part.text}</p>)
            : <p className="text-fg-secondary">This entry uses a format Durtal does not show</p>}
        </div>) : state.packs.length ? <p className="text-fg-secondary">No entry for ‘{word}’ in dictionaries on this device.</p> :
        <p className="text-fg-secondary">No dictionary for {languageName(language)} on this device. <Link className="underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center" href="/settings/reader#dictionaries">Add one in Settings › Reader</Link></p>}
      {state.packError && <p role="status" className="text-fg-secondary">{state.packError}</p>}
    </section>
    {state.offline ? <p role="status" className="text-fg-secondary">No connection</p> : <>
      <section><h3 className="type-caption mb-2">Wiktionary (English glosses)</h3>
        {!state.english ? <LookupSkeleton /> : state.english.status === "rejected" ? <Unreachable name="Wiktionary" href={"https://en.wiktionary.org/w/index.php?search=" + encodeURIComponent(word)} /> :
          english && english.format === "html" ? <LookupHtml html={english.html} base={base} /> :
          english && english.sections.length ? <>
            {!english.found && <p className="mb-3 text-fg-secondary">No {languageName(language)} entry for ‘{word}’. Entries in other languages:</p>}
            {english.sections.map((section, index) => <div key={index} className="mb-3">
              {!english.found && <h4 className="type-caption">{section.language}</h4>}
              <p className="type-caption mb-1 text-fg-secondary">{section.partOfSpeech}</p>
              {section.definitions.map((definition, index) => <div key={index}>
                <LookupHtml html={definition.html} base={base} />
                {definition.examples.map((example, index) => <LookupHtml key={index} html={example} base={base} className="italic text-fg-secondary" />)}
              </div>)}
            </div>)}
          </> : <p className="text-fg-secondary">No entry for ‘{word}’ in Wiktionary. <a className="underline" href={"https://en.wiktionary.org/w/index.php?search=" + encodeURIComponent(word)} target="_blank" rel="noopener noreferrer">Search Wiktionary ↗</a></p>}
        {english && <LookupAttribution wiki="Wiktionary" href={base} label="Open the entry" />}
      </section>
      {ownName[language] && <section><h3 className="type-caption mb-2">{ownName[language]}</h3>
        {!state.own ? <LookupSkeleton /> : state.own.status === "rejected" ? <Unreachable name={ownName[language]} href={"https://" + language + ".wiktionary.org/w/index.php?search=" + encodeURIComponent(word)} /> :
          own?.found ? <LookupHtml html={own.html} base={"https://" + language + ".wiktionary.org/wiki/" + wikimediaTitle(own.word)} /> :
          <p className="text-fg-secondary">No entry for ‘{word}’ in {ownName[language]}.</p>}
        {own && <LookupAttribution wiki="Wiktionary" href={"https://" + language + ".wiktionary.org/wiki/" + wikimediaTitle(own.word)} label="Open the entry" />}
      </section>}
    </>}
  </div>;
}
