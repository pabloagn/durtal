"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { EditionCover } from "@/components/books/edition-cover";
import { MatchAgainDialog } from "@/components/books/match-again-dialog";
import {
  findEditionCandidates,
  identifyEdition,
  keepWithoutIsbn,
  undoIdentification,
  moveToExistingEdition,
  type CandidateSearch,
  type IdentifyUndo,
  type QueueItem,
} from "@/lib/actions/identify";
import type { Candidate } from "@/lib/match/identify";
import { STATUS_CONFIG } from "@/lib/constants/catalogue";
import type { CatalogueStatus } from "@/lib/types";
import { languageName } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

type SearchState =
  | { status: "loading" }
  | { status: "ready"; result: CandidateSearch }
  | { status: "error"; error: string };

const SHOWN = 3;
const NO_KEYS = { coverS3Key: null, thumbnailS3Key: null };

const results = (n: number) => `${n} ${n === 1 ? "result" : "results"}`;

const message = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

function copiesText(copies: QueueItem["copies"]) {
  if (!copies.length) return "No copies";
  const places = [...new Set(copies.map((c) => c.location))];
  return `${copies.length} ${copies.length === 1 ? "copy" : "copies"} · ${places.join(", ")}`;
}

function CandidateCard({
  candidate,
  disabled,
  onPick,
}: {
  candidate: Candidate;
  disabled: boolean;
  onPick: () => void;
}) {
  const format =
    bindingLabel(candidate.binding) ??
    (candidate.format === "ebook"
      ? "eBook"
      : candidate.format === "audio"
        ? "Audiobook"
        : null);
  // A typed ISBN can name another book
  const doubtful =
    candidate.notes.includes("Another title") &&
    candidate.notes.includes("Another author");
  const details = [
    candidate.publicationYear,
    format,
    candidate.pageCount && `${candidate.pageCount} pages`,
    languageName(candidate.language),
  ].filter(Boolean);
  return (
    <div className="flex gap-3 rounded-sm border border-glass-border bg-bg-primary/40 p-3">
      <div className="h-24 w-16 shrink-0 overflow-hidden bg-bg-secondary">
        {candidate.coverUrl ? (
          <img
            src={candidate.coverUrl}
            alt={`${candidate.title ?? "Edition"} cover`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-center text-micro text-fg-secondary">
            No cover
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="lines-2 text-sm text-fg-primary">{candidate.title}</p>
        <p className="lines-1 text-xs text-fg-secondary">
          {candidate.publisher ?? "No publisher"}
        </p>
        <p className="lines-2 text-xs text-fg-secondary">{details.join(" · ")}</p>
        <p className="font-mono text-micro text-fg-secondary">
          {candidate.isbn13}
        </p>
        {candidate.notes.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {candidate.notes.map((n) => (
              <Badge key={n} variant="gold">
                {n}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-auto pt-2">
          <Button
            size="sm"
            variant={doubtful ? "ghost" : "secondary"}
            disabled={disabled}
            onClick={onPick}
          >
            {doubtful ? "Pick anyway" : "Pick"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One placeholder edition at a time (task 0187): the book, its copies, the
 * identified editions it already has, and the ISBNdb editions that can be
 * it. A pick saves at once and can be undone from the message that follows.
 */
export function IdentifyQueue({
  items,
  startAt,
}: {
  items: QueueItem[];
  startAt?: string;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[]>(() => {
    const ids = items.map((i) => i.id);
    return startAt && ids.includes(startAt)
      ? [startAt, ...ids.filter((id) => id !== startAt)]
      : ids;
  });
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [searches, setSearches] = useState<Record<string, SearchState>>({});
  // What the reader typed in the search box, per placeholder
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [confirmUse, setConfirmUse] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const left = order.filter((id) => byId.has(id) && !done.has(id));
  const current = left[0] ? byId.get(left[0])! : null;
  const nextId = left[1] ?? null;
  const search = current ? searches[current.id] : undefined;

  const load = useCallback(async (id: string, q?: string) => {
    setSearches((s) => ({ ...s, [id]: { status: "loading" } }));
    try {
      const result = await findEditionCandidates(id, q);
      setSearches((s) => ({ ...s, [id]: { status: "ready", result } }));
    } catch (err) {
      setSearches((s) => ({
        ...s,
        [id]: { status: "error", error: message(err, "ISBNdb did not answer") },
      }));
    }
  }, []);

  // Search for the current book; then prepare the next one
  useEffect(() => {
    if (!current) return;
    if (!searches[current.id]) load(current.id);
    else if (searches[current.id].status !== "loading" && nextId && !searches[nextId])
      load(nextId);
  }, [current, nextId, searches, load]);

  function finish(id: string) {
    setDone((d) => new Set(d).add(id));
    setShowAll(false);
    setConfirmUse(null);
    triggerActivityRefresh();
  }

  async function undo(id: string, data: IdentifyUndo) {
    try {
      await undoIdentification(id, data);
      setDone((d) => {
        const n = new Set(d);
        n.delete(id);
        return n;
      });
      setOrder((o) => [id, ...o.filter((x) => x !== id)]);
      triggerActivityRefresh();
      toast.success("Undone");
    } catch (err) {
      toast.error(message(err, "Could not undo"));
    }
  }

  async function run<T>(action: () => Promise<T>, fallback: string) {
    setBusy(true);
    try {
      return await action();
    } catch (err) {
      toast.error(message(err, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function pick(item: QueueItem, candidate: Candidate) {
    const res = await run(
      () => identifyEdition(item.id, candidate.isbn13),
      "Could not save the edition",
    );
    if (!res) return;
    finish(item.id);
    const what = [res.publisher, res.year].filter(Boolean).join(", ");
    toast.success(
      `${item.workTitle}: ${what || "identified"}${res.coverSkipped ? ". The cover could not be downloaded" : ""}`,
      {
        duration: 10000,
        action: { label: "Undo", onClick: () => undo(item.id, res.undo) },
      },
    );
  }

  async function keep(item: QueueItem) {
    const res = await run(() => keepWithoutIsbn(item.id), "Could not save");
    if (!res) return;
    finish(item.id);
    toast.success(`${item.workTitle}: kept without an ISBN`, {
      duration: 10000,
      action: { label: "Undo", onClick: () => undo(item.id, res) },
    });
  }

  async function moveToEdition(item: QueueItem, editionId: string, isbn: string | null) {
    const res = await run(
      () => moveToExistingEdition(item.id, editionId),
      "Could not move the copies",
    );
    if (!res) return;
    finish(item.id);
    router.refresh();
    toast.success(
      `${item.workTitle}: ${res.copies} ${res.copies === 1 ? "copy" : "copies"} moved to ${isbn ?? "your edition"}. The placeholder is removed.`,
    );
  }

  function skip() {
    if (!current) return;
    setOrder((o) => [...o.filter((x) => x !== current.id), current.id]);
    setShowAll(false);
    setConfirmUse(null);
  }

  if (!current)
    return (
      <p className="text-sm text-fg-secondary">
        Every edition in this list is done.{" "}
        <Link href="/library" className="text-accent-blue">
          Back to the library
        </Link>
      </p>
    );

  const candidates = search?.status === "ready" ? search.result.candidates : [];
  const shown = showAll ? candidates : candidates.slice(0, SHOWN);
  const status = STATUS_CONFIG[current.status as CatalogueStatus];
  const query =
    typed[current.id] ??
    (search?.status === "ready"
      ? search.result.query
      : [current.workTitle, current.authors[0]].filter(Boolean).join(" "));

  return (
    <div className="space-y-8">
      <p className="text-xs text-fg-secondary">
        {left.length} left{done.size > 0 && ` · ${done.size} done`}
      </p>

      {/* The book */}
      <div className="flex gap-4">
        <EditionCover
          edition={NO_KEYS}
          poster={current.poster}
          title={current.workTitle}
        />
        <div className="min-w-0 flex-1">
          <h2 className="type-section-title">{current.workTitle}</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            {[current.authors.join(", "), current.originalYear]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
            {status && <Badge variant={status.variant}>{status.label}</Badge>}
            <span>{copiesText(current.copies)}</span>
            {current.houses.length > 0 && (
              <span className="text-fg-secondary">
                House: {current.houses.join(", ")}
              </span>
            )}
            {current.collections > 0 && (
              <span className="text-fg-secondary">
                In {current.collections}{" "}
                {current.collections === 1 ? "collection" : "collections"}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={skip}>
              Skip
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => keep(current)}
            >
              No ISBN: keep it as it is
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setMatching(true)}
            >
              Other sources
            </Button>
            {current.workSlug && (
              <Link
                href={`/library/${current.workSlug}`}
                className="inline-flex items-center px-2 text-xs text-fg-secondary hover:text-fg-primary"
              >
                Open the book
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Identified editions the book already has */}
      {current.otherEditions.length > 0 && (
        <section className="space-y-3">
          <h3 className="type-caption">
            Your editions of this book
          </h3>
          <p className="text-xs text-fg-secondary">
            This book already has an identified edition. If the placeholder is
            the same book, use that edition: the placeholder&apos;s copies and
            collections move to it, and the empty placeholder is removed.
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
            {current.otherEditions.map((o) => (
              <div
                key={o.id}
                className="flex gap-3 rounded-sm border border-glass-border bg-bg-primary/40 p-3"
              >
                <EditionCover
                  edition={{ coverS3Key: o.coverKey, thumbnailS3Key: o.coverKey }}
                  title={o.title}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="lines-2 text-sm text-fg-primary">{o.title}</p>
                  <p className="lines-1 text-xs text-fg-secondary">
                    {[o.publisher, o.year].filter(Boolean).join(", ") || "No publisher"}
                  </p>
                  <p className="font-mono text-micro text-fg-secondary">
                    {o.isbn13 ?? "No ISBN"}
                  </p>
                  <p className="text-xs text-fg-secondary">
                    {o.copies} {o.copies === 1 ? "copy" : "copies"}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-2">
                    {confirmUse === o.id ? (
                      // Cancel takes the place of the first button: a
                      // double click does not confirm
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmUse(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => moveToEdition(current, o.id, o.isbn13)}
                        >
                          Move {current.copies.length}{" "}
                          {current.copies.length === 1 ? "copy" : "copies"} here
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setConfirmUse(o.id)}
                      >
                        Use this edition
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ISBNdb editions */}
      <section className="space-y-3">
        <h3 className="type-caption">
          Editions on ISBNdb
        </h3>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            load(current.id, query);
            setShowAll(false);
          }}
        >
          <div className="flex-1">
            <Input
              value={query}
              onChange={(e) =>
                setTyped((t) => ({ ...t, [current.id]: e.target.value }))
              }
              aria-label="Search ISBNdb"
              placeholder="Title and author, or an ISBN"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || search?.status === "loading" || !query.trim()}
          >
            Search
          </Button>
        </form>

        {search?.status === "loading" || !search ? (
          <div className="flex items-center gap-2 py-8 text-xs text-fg-secondary">
            <Spinner className="h-4 w-4" />
            Searching ISBNdb...
          </div>
        ) : search.status === "error" ? (
          <p className="py-4 text-sm text-fg-secondary">{search.error}</p>
        ) : candidates.length === 0 ? (
          <p className="py-4 text-sm text-fg-secondary">
            {search.result.found
              ? `ISBNdb sent ${results(search.result.found)}, and none of them can be this book.`
              : "ISBNdb found nothing."}{" "}
            Change the search, try other sources, or keep it without an ISBN.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
              {shown.map((c) => (
                <CandidateCard
                  key={c.isbn13}
                  candidate={c}
                  disabled={busy}
                  onPick={() => pick(current, c)}
                />
              ))}
            </div>
            <p className="text-xs text-fg-secondary">
              {candidates.length > SHOWN && (
                <button
                  type="button"
                  className="mr-2 text-accent-blue"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll
                    ? "Show the best 3"
                    : `Show ${candidates.length - SHOWN} more`}
                </button>
              )}
              ISBNdb sent {results(search.result.found)};{" "}
              {search.result.eligible} can be this book
              {search.result.eligible > candidates.length &&
                `. The best ${candidates.length} are here`}
              .
            </p>
          </>
        )}
      </section>

      {matching && (
        <MatchAgainDialog
          open
          onClose={() => {
            setMatching(false);
            router.refresh();
          }}
          workId={current.workId}
          editionId={current.id}
          currentTitle={current.workTitle}
          currentAuthor={current.authors[0] ?? ""}
          currentMetadataSource={null}
        />
      )}
    </div>
  );
}
