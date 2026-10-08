"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  applyPaintingSource,
  reviewPaintingSource,
  searchPaintingSource,
  type PaintingSourceReview,
} from "@/lib/actions/painting-sources";

type Museum = "artic" | "metmuseum";
const MUSEUMS: { value: Museum; label: string }[] = [
  { value: "artic", label: "Art Institute of Chicago" },
  { value: "metmuseum", label: "The Met" },
];
const VERDICTS = {
  fill: "Empty here: fills it",
  same: "The same here",
  conflict: "Differs: the value here stays",
  locked: "Locked: the value here stays",
} as const;
const ACTIONS = { record: "Record where it is shown", verify: "Mark the location checked", move: "Record the move" } as const;

interface Hit {
  externalId: string;
  title: string;
  detail: string | null;
}

/**
 * Looks a painting up in a museum's open collection and shows the answer
 * beside the painting and its original. Only empty fields fill; a location
 * is taken only from the museum's own dated "on view" answer.
 */
export function PaintingSourceLookup({
  painting,
  originals,
}: {
  painting: { id: string; title: string; fingerprint: string };
  /** The painting's originals, to choose which one the answer is about */
  originals: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
        Look up
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Look up in a museum" description={painting.title} className="max-w-xl">
        {open && <Lookup painting={painting} originals={originals} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function Row({
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
  lines: (string | null)[];
}) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onChange} />
      <div className="min-w-0 flex-1">
        <p className="text-fg-primary">{title}</p>
        {lines.filter(Boolean).map((line, i) => (
          <p key={i} className={i === 0 ? "line-clamp-2 break-words text-fg-secondary" : "text-xs text-fg-secondary"}>
            {line}
          </p>
        ))}
      </div>
    </li>
  );
}

function Lookup({
  painting,
  originals,
  onDone,
}: {
  painting: { id: string; title: string; fingerprint: string };
  originals: { id: string; label: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [museum, setMuseum] = useState<Museum>("artic");
  const [objectId, setObjectId] = useState<string | null>(originals[0]?.id ?? null);
  const [query, setQuery] = useState(painting.title);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [review, setReview] = useState<PaintingSourceReview | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await searchPaintingSource({ museum, text: query });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setHits(result.hits);
  }

  async function pick(hit: Hit) {
    setBusy(true);
    setError(null);
    const result = await reviewPaintingSource({ museum, paintingId: painting.id, externalId: hit.externalId, objectId });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setReview(result);
    // Empty fields and new facts start on; a move never does
    setChosen(
      new Set([
        ...result.work.filter((f) => f.verdict === "fill" && f.field !== "title").map((f) => `work:${f.field}`),
        ...(result.painter && !result.painter.here && !result.painter.others.length ? ["painter"] : []),
        ...result.objectFields.filter((f) => f.verdict === "fill").map((f) => `object:${f.field}`),
        ...(!result.object ? ["createObject"] : []),
        ...(result.location.action === "record" || result.location.action === "verify" ? ["location"] : []),
      ]),
    );
  }

  async function save() {
    if (!review || busy) return;
    setBusy(true);
    setError(null);
    const result = await applyPaintingSource({
      museum: review.museum,
      paintingId: painting.id,
      externalId: review.externalId,
      objectId: review.object?.id ?? null,
      fingerprint: painting.fingerprint,
      objectFingerprint: review.object?.fingerprint ?? null,
      historyFingerprint: review.location.historyFingerprint,
      work: chosen.has("work:creationDate") ? ["creationDate"] : [],
      painter: chosen.has("painter"),
      object: (["accessionNumber", "owner", "dimensions"] as const).filter((f) => chosen.has(`object:${f}`)),
      createObject: chosen.has("createObject"),
      location: chosen.has("location"),
    });
    if ("error" in result) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // The museum's own image, credited as it asks
    if (chosen.has("image") && review.image && result.objectId) {
      const res = await fetch("/api/media/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "art_object",
          entityId: result.objectId,
          mediaType: "poster",
          imageUrl: review.image.url,
          attribution: {
            altText: review.title,
            credit: review.image.credit,
            license: review.image.license,
            sourceUrl: review.url,
            sourceRecordId: result.sourceRecordId,
          },
        }),
      });
      if (!res.ok) toast.error("The painting is saved, but not the museum's image");
      else result.added.push("Image");
    }
    toast.success(result.added.length ? `Saved from ${review.museumName}: ${result.added.join(", ")}` : `${review.museumName} kept as a source`);
    onDone();
    router.refresh();
  }

  if (review) {
    const locked = review.locked;
    return (
      <div className="space-y-5" data-shortcut-scope="">
        <div className="space-y-1">
          <p className="flex items-start gap-1.5 text-sm text-fg-primary">
            {review.url ? (
              <>
                <a href={review.url} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-accent-primary">
                  {review.title}, {review.museumName}
                </a>
                <CapAligned height={12}>
                  <ExternalLink className="h-3 w-3 text-fg-muted" strokeWidth={1.5} aria-hidden />
                </CapAligned>
              </>
            ) : (
              review.title
            )}
          </p>
          <p className="text-xs text-fg-secondary">{[review.attribution, review.medium].filter(Boolean).join(" · ")}</p>
        </div>
        {locked && (
          <p role="status" className="text-sm text-fg-secondary">
            A locked {review.museumName} source keeps this painting as it is. Unlock it under Sources to save from the museum again.
          </p>
        )}
        {review.previous && (
          <div className="space-y-1 text-xs text-fg-secondary" role="status">
            <p>
              Last asked {review.previous.ageDays} {review.previous.ageDays === 1 ? "day" : "days"} ago
              {review.previous.stale ? ": that answer is stale." : "."}{" "}
              {review.previous.changes.length ? "Since then the museum changed:" : "Nothing changed since."}
            </p>
            {review.previous.changes.length > 0 && (
              <ul className="space-y-0.5">
                {review.previous.changes.map((c) => (
                  <li key={c.field}>
                    {c.field}: {c.before ?? "none"} → {c.after ?? "none"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <section className="space-y-3" aria-label="The work">
          <h3 className="type-group-title">The work</h3>
          <ul className="space-y-3">
            {review.work.map((f) => (
              <Row
                key={f.field}
                checked={chosen.has(`work:${f.field}`)}
                disabled={locked || f.verdict !== "fill" || f.field === "title"}
                label={`Fill the ${f.label.toLowerCase()} from the museum`}
                onChange={(on) => toggle(`work:${f.field}`, on)}
                title={f.label}
                lines={[f.source, `${VERDICTS[f.verdict]}${f.verdict === "conflict" && f.here ? ` (${f.here})` : ""}`]}
              />
            ))}
            {review.painter && (
              <Row
                checked={chosen.has("painter")}
                disabled={locked || review.painter.here}
                label={`Credit ${review.painter.name} as attributed painter`}
                onChange={(on) => toggle("painter", on)}
                title="Painter"
                lines={[
                  review.painter.attribution ?? review.painter.name,
                  review.painter.here
                    ? "Already credited"
                    : review.painter.others.length
                      ? `Here: ${review.painter.others.join(", ")}. Adding credits both`
                      : review.painter.match
                        ? `Credits ${review.painter.match.name} from your library, as attributed`
                        : "Not in your library yet: adds them, as attributed",
                ]}
              />
            )}
          </ul>
        </section>

        <section className="space-y-3" aria-label="The original">
          <h3 className="type-group-title">{review.object ? review.object.label : "The original"}</h3>
          <ul className="space-y-3">
            {!review.object && (
              <Row
                checked={chosen.has("createObject")}
                disabled={locked}
                label="Add the original"
                onChange={(on) => toggle("createObject", on)}
                title="Add the original"
                lines={[`Owned by ${review.owner.name}, with the facts below`, review.owner.match ? null : `${review.owner.name} is added to Organizations`]}
              />
            )}
            {review.objectFields.map((f) => (
              <Row
                key={f.field}
                checked={!review.object ? chosen.has("createObject") : chosen.has(`object:${f.field}`)}
                disabled={locked || !review.object || f.verdict !== "fill"}
                label={`Fill the ${f.label.toLowerCase()} from the museum`}
                onChange={(on) => toggle(`object:${f.field}`, on)}
                title={f.label}
                lines={[f.source, review.object ? `${VERDICTS[f.verdict]}${f.verdict === "conflict" && f.here ? ` (${f.here})` : ""}` : null]}
              />
            ))}
            <Row
              checked={chosen.has("location") && !!review.location.action}
              disabled={locked || !review.location.action || (!review.object && !chosen.has("createObject"))}
              label={review.location.action ? ACTIONS[review.location.action] : "No location to record"}
              onChange={(on) => toggle("location", on)}
              title="Where it is"
              lines={[review.location.says, review.location.note]}
            />
            {review.image && (
              <Row
                checked={chosen.has("image")}
                disabled={locked || (!review.object && !chosen.has("createObject"))}
                label="Add the museum's image to the original"
                onChange={(on) => toggle("image", on)}
                title="Image"
                lines={[`${review.image.credit}${review.image.license ? `, ${review.image.license}` : ""}`, "Added to the original with its credit and license"]}
              />
            )}
          </ul>
        </section>

        {error && (
          <p role="alert" className="text-sm text-accent-red-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setReview(null)}>
            Back
          </Button>
          <Button variant="primary" data-shortcut="save" disabled={busy || locked} onClick={save}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SegmentedControl
        ariaLabel="Museum"
        value={museum}
        onChange={(value) => {
          setMuseum(value);
          setHits(null);
        }}
        options={MUSEUMS}
      />
      {originals.length > 1 && (
        <Select
          label="About"
          value={objectId ?? ""}
          onChange={(e) => setObjectId(e.target.value || null)}
          options={originals.map((o) => ({ value: o.id, label: o.label }))}
        />
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input label="Title" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={300} />
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !query.trim()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          Search
        </Button>
      </form>
      {hits && hits.length === 0 && <p className="text-sm text-fg-secondary">Nothing of that title in this museum&apos;s collection</p>}
      {hits && hits.length > 0 && (
        <ul className="space-y-1" aria-label="Works in the collection">
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
        Each museum knows its own collection only. A museum&apos;s ownership never places a painting: only its own dated
        &ldquo;on view&rdquo; answer can.
      </p>
    </div>
  );
}
