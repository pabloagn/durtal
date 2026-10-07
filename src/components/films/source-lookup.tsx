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
import { formatRuntime } from "@/lib/catalogue/film-labels";
import {
  applyFilmSource,
  reviewFilmSource,
  searchFilmSource,
  type FilmSourceHit,
  type FilmSourceReview,
} from "@/lib/actions/film-sources";

const VERDICTS = {
  fill: "Empty here: fills it",
  same: "The same here",
  conflict: "Differs: the value here stays",
  locked: "Locked: the value here stays",
  unlisted: "Not in Durtal's list: enter it by hand",
} as const;

type Film = { id: string; title: string; fingerprint: string };

/**
 * Looks a film up on Wikidata and shows what it says beside what the film
 * has. Only empty fields can be filled; cast, crew, companies, ids and
 * releases can be added. A different value stays as it is here.
 */
export function FilmSourceLookup({ film }: { film: Film }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
        Look up
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Look up on Wikidata" description={film.title} className="max-w-xl">
        {open && <Lookup film={film} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

/** One switch and what it would add or fill */
function Choice({
  checked,
  disabled,
  label,
  onChange,
  title,
  lines,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (on: boolean) => void;
  title: string;
  /** The value, then what saving does with it; the last line is the small one */
  lines: (string | null)[];
}) {
  const shown = lines.filter((line): line is string => !!line);
  return (
    <li className="flex items-start gap-3 text-sm">
      <Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onChange} />
      <div className="min-w-0 flex-1">
        <p className="break-words text-fg-primary">{title}</p>
        {shown.map((line, i) => (
          <p key={i} className={i < shown.length - 1 ? "line-clamp-2 break-words text-fg-secondary" : "text-xs text-fg-secondary"}>
            {line}
          </p>
        ))}
      </div>
    </li>
  );
}

function Lookup({ film, onDone }: { film: Film; onDone: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState(film.title);
  const [hits, setHits] = useState<FilmSourceHit[] | null>(null);
  const [review, setReview] = useState<FilmSourceReview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [sameFilm, setSameFilm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await searchFilmSource(query);
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setHits(result.hits);
  }

  async function pick(hit: FilmSourceHit) {
    setBusy(true);
    setError(null);
    const result = await reviewFilmSource({ filmId: film.id, externalId: hit.externalId });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setReview(result);
    setSameFilm(false);
    // Everything that only fills or adds starts on; a running time or release the film has stays off
    setChosen(
      new Set([
        ...result.fields.filter((f) => f.verdict === "fill" && f.field !== "title").map((f) => `field:${f.field}`),
        ...result.credits.filter((c) => !c.here).map((c) => `credit:${c.key}`),
        ...result.organizations.filter((o) => !o.here).map((o) => `organization:${o.wikidataId}`),
        ...result.identifiers.filter((i) => !i.here && !i.heldBy).map((i) => `id:${i.provider}`),
        ...(result.runtime?.verdict === "fill" ? ["runtime"] : []),
        ...result.releases.filter((r) => !r.here).map((r) => `release:${r.index}`),
      ]),
    );
  }

  async function save() {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    const pickedOf = (prefix: string) => [...chosen].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    const result = await applyFilmSource({
      filmId: film.id,
      fingerprint: film.fingerprint,
      externalId: review.externalId,
      sameFilm,
      fields: pickedOf("field:") as ("originalTitle" | "description" | "releaseDate" | "countries" | "languages")[],
      credits: pickedOf("credit:"),
      organizations: pickedOf("organization:"),
      identifiers: pickedOf("id:") as ("imdb" | "tmdb" | "letterboxd")[],
      runtime: chosen.has("runtime"),
      releases: pickedOf("release:").map(Number),
    });
    if ("error" in result) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // The poster from Commons, credited as Commons states it
    if (chosen.has("image") && review.image && !review.image.here) {
      const res = await fetch("/api/media/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "work",
          entityId: film.id,
          mediaType: "poster",
          imageUrl: review.image.url,
          attribution: {
            altText: film.title,
            credit: review.image.credit,
            license: review.image.license,
            sourceUrl: review.image.page,
            sourceRecordId: result.sourceRecordId,
          },
        }),
      });
      if (!res.ok) toast.error("The film is saved, but not the poster");
      else result.added.push(review.image.kind === "poster" ? "Poster" : "Image");
    }
    toast.success(result.added.length ? `Saved from Wikidata: ${result.added.join(", ")}` : "Wikidata kept as a source");
    onDone();
    router.refresh();
  }

  const set = (key: string, on: boolean) =>
    setChosen((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  if (review) {
    const stopped = review.locked || !!review.heldBy;
    const blocked = stopped || (review.year.differs && !sameFilm);
    const where = review.version.id ? `the version ${review.version.label ?? "here"}` : "a new version";
    return (
      <div className="space-y-5" data-shortcut-scope="">
        <p className="flex items-start gap-1.5 text-sm text-fg-primary">
          {review.url ? (
            <>
              <a href={review.url} target="_blank" rel="noopener noreferrer" className="touch-hit transition-colors hover:text-accent-rose-text">
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
            A locked Wikidata source keeps this film as it is. Unlock it under Sources to save from Wikidata again.
          </p>
        )}
        {review.heldBy && (
          <p role="status" className="text-sm text-fg-secondary">
            This Wikidata film is already {review.heldBy.title} here. A remake is a separate film: look up the other one.
          </p>
        )}
        {review.year.differs && !stopped && (
          <ul className="space-y-3">
            <Choice
              checked={sameFilm}
              disabled={busy}
              label="It is the same film"
              onChange={setSameFilm}
              title="It is the same film"
              lines={[`Wikidata's film is from ${review.year.source}, this one from ${review.year.here}. A remake is a separate film.`]}
            />
          </ul>
        )}
        {review.previous && review.previous.changes.length > 0 && (
          <div role="status" className="space-y-1 text-sm">
            <p className="text-fg-primary">Changed on Wikidata since it was last saved here</p>
            <ul className="space-y-0.5 text-xs text-fg-secondary">
              {review.previous.changes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <ul className="space-y-3" aria-label="What Wikidata says">
          {review.fields.map((f) => (
            <Choice
              key={f.field}
              checked={chosen.has(`field:${f.field}`)}
              disabled={f.verdict !== "fill" || f.field === "title" || stopped}
              label={`Fill ${f.label.toLowerCase()} from Wikidata`}
              onChange={(on) => set(`field:${f.field}`, on)}
              title={f.label}
              lines={[
                f.source,
                `${VERDICTS[f.verdict]}${f.verdict === "conflict" && f.here ? ` (${f.here})` : ""}${f.verdict !== "unlisted" && f.unmatched?.length ? `. Not in Durtal's list: ${f.unmatched.join(", ")}` : ""}`,
              ]}
            />
          ))}
          {review.runtime && (
            <Choice
              checked={chosen.has("runtime")}
              disabled={review.runtime.verdict !== "fill" || stopped}
              label="Fill the running time from Wikidata"
              onChange={(on) => set("runtime", on)}
              title="Running time"
              lines={[
                formatRuntime(review.runtime.seconds),
                `${VERDICTS[review.runtime.verdict]}${review.runtime.verdict === "conflict" ? ` (${formatRuntime(review.runtime.here)})` : ""}, on ${where}`,
              ]}
            />
          )}
          {review.image && !review.image.here && (
            <Choice
              checked={chosen.has("image")}
              disabled={stopped}
              label={`Add the ${review.image.kind} from Wikimedia Commons`}
              onChange={(on) => set("image", on)}
              title={review.image.kind === "poster" ? "Poster" : "Image"}
              lines={[
                [review.image.credit, review.image.license].filter(Boolean).join(", ") || "Credit as Wikimedia Commons states it",
                "From Wikimedia Commons, with its credit and license",
              ]}
            />
          )}
        </ul>

        {review.credits.length > 0 && (
          <ul className="space-y-3" aria-label="Cast and crew on Wikidata">
            {review.credits.map((c) => (
              <Choice
                key={c.key}
                checked={chosen.has(`credit:${c.key}`) && !c.here}
                disabled={c.here || stopped}
                label={`Add ${c.name} as ${c.role.toLowerCase()}`}
                onChange={(on) => set(`credit:${c.key}`, on)}
                title={`${c.role}: ${c.name}`}
                lines={[
                  c.characters.length ? c.characters.join(", ") : null,
                  c.here ? "Already on this film" : c.match ? `Adds ${c.match.name} from your library` : "Not in your library yet: adds them",
                ]}
              />
            ))}
          </ul>
        )}

        {(review.organizations.length > 0 || review.identifiers.length > 0 || review.releases.length > 0) && (
          <ul className="space-y-3" aria-label="Companies, ids and releases on Wikidata">
            {review.organizations.map((o) => (
              <Choice
                key={o.wikidataId}
                checked={chosen.has(`organization:${o.wikidataId}`) && !o.here}
                disabled={o.here || stopped}
                label={`Add ${o.name} as production company`}
                onChange={(on) => set(`organization:${o.wikidataId}`, on)}
                title={`Production company: ${o.name}`}
                lines={[o.here ? "Already on this film" : o.match ? `Adds ${o.match.name} from your library` : "Not in your library yet: adds it"]}
              />
            ))}
            {review.identifiers.map((i) => (
              <Choice
                key={i.provider}
                checked={chosen.has(`id:${i.provider}`) && !i.here && !i.heldBy}
                disabled={i.here || !!i.heldBy || stopped}
                label={`Keep the ${i.name} id`}
                onChange={(on) => set(`id:${i.provider}`, on)}
                title={`${i.name} id: ${i.externalId}`}
                lines={[i.here ? "Already kept for this film" : i.heldBy ? `Already kept for ${i.heldBy}` : "Keeps it with this film"]}
              />
            ))}
            {review.releases.map((r) => (
              <Choice
                key={r.index}
                checked={chosen.has(`release:${r.index}`) && !r.here}
                disabled={r.here || stopped}
                label={`Add the release of ${r.date}${r.place ? ` in ${r.place}` : ""}`}
                onChange={(on) => set(`release:${r.index}`, on)}
                title={`Release: ${r.date}${r.place ? `, ${r.place}` : ""}`}
                lines={[r.here ? "Already on this film" : `${r.formatLabel}, on ${where}`]}
              />
            ))}
          </ul>
        )}

        <p className="text-xs text-fg-secondary">
          Wikidata has {review.covers.charAt(0).toLowerCase() + review.covers.slice(1)}.
          {review.unnamedCredits > 0 && ` It names ${review.unnamedCredits} more ${review.unnamedCredits === 1 ? "person" : "people"} without an English name.`}{" "}
          Credits and releases here that it does not name stay. Saving keeps Wikidata as a source of this film.
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
          <Button variant="primary" data-shortcut="save" disabled={busy || blocked} onClick={save}>
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
          <Input label="Title, or an IMDb or TMDB link" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={300} />
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !query.trim()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          Search
        </Button>
      </form>
      {hits && hits.length === 0 && <p className="text-sm text-fg-secondary">No film of that title on Wikidata</p>}
      {hits && hits.length > 0 && (
        <ul className="space-y-1" aria-label="Films on Wikidata">
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
        Wikidata is the one film source with a public API that needs no key. TMDB, IMDb and Letterboxd are not connected: add them as
        sources and enter what they say. A remake is a separate film: the year and director tell them apart.
      </p>
    </div>
  );
}
