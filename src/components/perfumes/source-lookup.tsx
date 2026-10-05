"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  applyPerfumeSource,
  reviewPerfumeSource,
  searchPerfumeSource,
  type PerfumeSourceReview,
  type SourceHit,
} from "@/lib/actions/perfume-sources";

const VERDICTS = {
  fill: "Empty here: fills it",
  same: "The same here",
  conflict: "Differs: the value here stays",
  locked: "Locked: the value here stays",
} as const;

/**
 * Looks a perfume up on Wikidata and shows what it says beside what the
 * perfume has. Only empty fields can be filled, and houses and perfumers
 * can be added; a different value stays as it is here.
 */
export function PerfumeSourceLookup({
  perfume,
}: {
  perfume: { id: string; title: string; fingerprint: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
        Look up
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Look up on Wikidata" description={perfume.title} className="max-w-xl">
        {open && <Lookup perfume={perfume} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function Lookup({ perfume, onDone }: { perfume: { id: string; title: string; fingerprint: string }; onDone: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState(perfume.title);
  const [hits, setHits] = useState<SourceHit[] | null>(null);
  const [covers, setCovers] = useState<string | null>(null);
  const [review, setReview] = useState<PerfumeSourceReview | null>(null);
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await searchPerfumeSource(query);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setHits(result.hits);
    setCovers(result.covers);
  }

  async function pick(hit: SourceHit) {
    setBusy(true);
    setError(null);
    const result = await reviewPerfumeSource({ perfumeId: perfume.id, externalId: hit.externalId });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setReview(result);
    setFields(new Set(result.fields.filter((f) => f.verdict === "fill" && f.field !== "title").map((f) => f.field)));
    setPeople(new Set([...result.organizations, ...result.perfumers].filter((x) => !x.here).map((x) => x.wikidataId)));
  }

  async function save() {
    if (!review || busy) return;
    setBusy(true);
    const result = await applyPerfumeSource({
      perfumeId: perfume.id,
      fingerprint: perfume.fingerprint,
      externalId: review.externalId,
      fields: [...fields].filter((f): f is "description" | "launched" => f === "description" || f === "launched"),
      organizations: review.organizations.filter((o) => people.has(o.wikidataId)).map((o) => o.wikidataId),
      perfumers: review.perfumers.filter((p) => people.has(p.wikidataId)).map((p) => p.wikidataId),
    });
    if ("error" in result) {
      setBusy(false);
      setError(result.error);
      return;
    }
    toast.success(result.added.length ? `Saved from Wikidata: ${result.added.join(", ")}` : "Wikidata kept as a source");
    onDone();
    router.refresh();
  }

  const toggle = (set: Set<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  if (review) {
    const others = [
      ...review.organizations.map((o) => ({ ...o, kind: o.role === "brand" ? "Brand" : "Manufacturer" })),
      ...review.perfumers.map((p) => ({ ...p, kind: "Perfumer" })),
    ];
    return (
      <div className="space-y-5" data-shortcut-scope="">
        <p className="flex items-start gap-1.5 text-sm text-fg-primary">
          {review.url ? (
            <>
              <a href={review.url} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent-rose-text">
                {review.title} on Wikidata
              </a>
              <CapAligned height={12}>
                <ExternalLink className="h-3 w-3 text-fg-muted" strokeWidth={1.5} aria-hidden />
              </CapAligned>
            </>
          ) : (
            review.title
          )}
        </p>
        {review.locked && (
          <p role="status" className="text-sm text-fg-secondary">
            A locked Wikidata source keeps this perfume as it is. Unlock it under Sources to save from Wikidata again.
          </p>
        )}
        <ul className="space-y-3" aria-label="What Wikidata says">
          {review.fields.map((f) => {
            const choosable = f.verdict === "fill" && f.field !== "title" && !review.locked;
            return (
              <li key={f.field} className="flex items-start gap-3 text-sm">
                <Switch
                  checked={fields.has(f.field)}
                  disabled={!choosable}
                  aria-label={`Fill ${f.label.toLowerCase()} from Wikidata`}
                  onCheckedChange={(on) => setFields((s) => toggle(s, f.field, on))}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-fg-primary">{f.label}</p>
                  <p className="lines-2 text-fg-secondary">{f.source}</p>
                  <p className="text-xs text-fg-secondary">
                    {VERDICTS[f.verdict]}
                    {f.verdict === "conflict" && f.here ? ` (${f.here})` : ""}
                  </p>
                </div>
              </li>
            );
          })}
          {others.map((x) => (
            <li key={`${x.kind}:${x.wikidataId}`} className="flex items-start gap-3 text-sm">
              <Switch
                checked={people.has(x.wikidataId) && !x.here}
                disabled={x.here || review.locked}
                aria-label={`Add ${x.name} as ${x.kind.toLowerCase()}`}
                onCheckedChange={(on) => setPeople((s) => toggle(s, x.wikidataId, on))}
              />
              <div className="min-w-0 flex-1">
                <p className="text-fg-primary">
                  {x.kind}: {x.name}
                </p>
                <p className="text-xs text-fg-secondary">
                  {x.here
                    ? "Already on this perfume"
                    : x.match
                      ? `Adds ${x.match.name} from your library`
                      : "Not in your library yet: adds it"}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-secondary">
          Wikidata has {review.covers.charAt(0).toLowerCase() + review.covers.slice(1)}. Notes and formulations stay yours to enter.
          Saving keeps Wikidata as a source of this perfume.
        </p>
        {error && (
          <p role="alert" className="text-sm text-accent-red-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setReview(null)}>
            Back
          </Button>
          <Button variant="primary" data-shortcut="save" disabled={busy || review.locked} onClick={save}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input label="Name" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={300} />
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !query.trim()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          Search
        </Button>
      </form>
      {hits && hits.length === 0 && <p className="text-sm text-fg-secondary">No perfume of that name on Wikidata</p>}
      {hits && hits.length > 0 && (
        <ul className="space-y-1" aria-label="Perfumes on Wikidata">
          {hits.map((hit) => (
            <li key={hit.externalId}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void pick(hit)}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-bg-tertiary"
              >
                <span className="block text-fg-primary">{hit.title}</span>
                <span className="block text-xs text-fg-secondary">{[hit.detail, hit.externalId].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <p className="text-xs text-fg-secondary">
        {covers ? `Wikidata has ${covers.charAt(0).toLowerCase() + covers.slice(1)}.` : "Wikidata is the one perfume source with a public API."}{" "}
        Fragrantica, Basenotes and Parfumo have none: add them as sources and enter what they say.
      </p>
    </div>
  );
}
