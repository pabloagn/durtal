"use client";

import { useEffect, useRef, useState } from "react";
import { searchWorksForCollection } from "@/lib/actions/collections";
import { readReviewWorkOptions } from "@/lib/actions/ebook-review-ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EditionChoiceFields, ReviewCopyFields } from "./edition-choice";
import type { EditionChoice, PrepareEbookReview, ReviewQueueRow, ReviewWorkOptions, ReviewPreparationIssue } from "@/lib/ebooks/review-queue/types";

/** Folded for comparing titles: case and accents ignored */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
/** Exact titles first, then titles that start with the search, then the rest in the search's own order (SLN-684) */
export function rankBooks<T extends { title: string }>(books: readonly T[], query: string): T[] {
  const wanted = fold(query);
  const rank = (title: string) => { const folded = fold(title); return folded === wanted ? 0 : folded.startsWith(wanted) ? 1 : 2; };
  return books.map((book, index) => ({ book, index, rank: rank(book.title) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ book }) => book);
}

export function ChooseBookFields({ row, onPrepare, disabled, issues = [], startWorkId = null }: {
  row: ReviewQueueRow; onPrepare: (intent: PrepareEbookReview) => void; disabled: boolean;
  issues?: readonly ReviewPreparationIssue[];
  /** "Link it back" (SLN-684): open on this book's editions rather than a search */
  startWorkId?: string | null;
}) {
  // Starts from the eBook's own title, already searched (SLN-684)
  const [query, setQuery] = useState(() => row.title.split(/[:;]/)[0].trim() || row.title);
  const [searched, setSearched] = useState<string | null>(null);
  const [books, setBooks] = useState<Awaited<ReturnType<typeof searchWorksForCollection>>>([]);
  const [options, setOptions] = useState<ReviewWorkOptions | null>(null);
  const [choice, setChoice] = useState<EditionChoice>({ kind: "new_edition", ...(row.language ? { language: row.language } : {}), isbn13: null });
  const [locationId, setLocation] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0), searchForm = useRef<HTMLFormElement>(null);
  async function search(text = query) {
    if (!text.trim()) return;
    const current = ++generation.current;
    setSearching(true); setError(null);
    try {
      const found = await searchWorksForCollection(text, "book", 30);
      if (generation.current === current) { setBooks(rankBooks(found, text)); setSearched(text.trim()); setOptions(null); }
    } catch { if (generation.current === current) setError("The book search could not be loaded."); }
    finally { if (generation.current === current) setSearching(false); }
  }
  useEffect(() => { void (startWorkId ? select(startWorkId) : search()); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function select(workId: string) {
    const current = ++generation.current;
    setSearching(true); setError(null);
    const result = await readReviewWorkOptions({ workId, ebookId: row.id }).catch(() => null);
    if (generation.current !== current) return;
    if (result?.ok) {
      setOptions(result.value); setLocation("");
      setChoice({ kind: "new_edition", ...(row.language ? { language: row.language } : {}), isbn13: null });
    } else setError(result && !result.ok ? result.error.message : "The editions could not be loaded.");
    setSearching(false);
  }
  return <div className="space-y-4">
    <form ref={searchForm} className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      {/* Stays on while the first search runs: a disabled field drops the focus the dialog gives it, and typing starts a new search */}
      <div className="min-w-0 flex-1"><Input label="Find a book" value={query} maxLength={200} disabled={disabled}
        error={issues.find((issue) => issue.field === "workId")?.message}
        onChange={(event) => { generation.current++; setQuery(event.target.value); setSearching(false); }} /></div>
      <Button type="submit" disabled={disabled || searching || !query.trim()}>Search</Button>
    </form>
    {!options && <div className="max-h-60 space-y-1 overflow-auto" aria-label="Book search results">
      {books.map((book) => <button key={book.workId} type="button" disabled={disabled || searching}
        className="block w-full rounded-sm px-3 py-2 text-left hover:bg-glass-highlight pointer-coarse:min-h-11"
        onClick={() => void select(book.workId)}><span className="block text-sm">{book.title}</span>
        <span className="text-xs text-fg-secondary">{book.creators}</span></button>)}
      {searched !== null && !searching && books.length === 0 && !error &&
        <p className="px-3 py-2 text-sm text-fg-secondary">No book matches “{searched}”. Try part of the title or the author’s name.</p>}
    </div>}
    {options && <form className="space-y-4" onSubmit={(event) => { event.preventDefault();
      onPrepare({ action: "link", ebookId: row.id, workId: options.workId, choice, ...(locationId ? { locationId } : {}) }); }}>
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="type-item-title">{options.title}</span>
        {/* Back to the books found, searching first when it opened on a book */}
        <button type="button" className="text-command text-xs" disabled={disabled} onClick={() => {
          generation.current++; setOptions(null); setSearching(false); if (searched === null) void search();
          // The button goes with the book: focus stays in the dialog, on the search
          searchForm.current?.querySelector("input")?.focus();
        }}>Choose another book</button>
      </p>
      <EditionChoiceFields options={options} row={row} choice={choice} onChange={setChoice} disabled={disabled} issues={issues} />
      {choice.kind !== "fill_copy" && <ReviewCopyFields options={options} locationId={locationId} onLocation={setLocation} disabled={disabled} issues={issues} />}
      <Button variant="primary" type="submit" disabled={disabled || (choice.kind === "new_edition" && !choice.language)}>Preview link</Button>
    </form>}
    {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
  </div>;
}
