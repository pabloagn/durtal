"use client";

import { useRef, useState } from "react";
import { searchWorksForCollection } from "@/lib/actions/collections";
import { readReviewWorkOptions } from "@/lib/actions/ebook-review-ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EditionChoiceFields, ReviewCopyFields } from "./edition-choice";
import type { EditionChoice, PrepareEbookReview, ReviewQueueRow, ReviewWorkOptions, ReviewPreparationIssue } from "@/lib/ebooks/review-queue/types";

export function ChooseBookFields({ row, onPrepare, disabled, issues = [] }: {
  row: ReviewQueueRow; onPrepare: (intent: PrepareEbookReview) => void; disabled: boolean;
  issues?: readonly ReviewPreparationIssue[];
}) {
  const [query, setQuery] = useState("");
  const [books, setBooks] = useState<Awaited<ReturnType<typeof searchWorksForCollection>>>([]);
  const [options, setOptions] = useState<ReviewWorkOptions | null>(null);
  const [choice, setChoice] = useState<EditionChoice>({ kind: "new_edition", ...(row.language ? { language: row.language } : {}), isbn13: null });
  const [locationId, setLocation] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  async function search() {
    const current = ++generation.current;
    setSearching(true); setError(null);
    try {
      const found = await searchWorksForCollection(query, "book", 30);
      if (generation.current === current) { setBooks(found); setOptions(null); }
    } catch { if (generation.current === current) setError("The book search could not be loaded."); }
    finally { if (generation.current === current) setSearching(false); }
  }
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
    <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
      <div className="min-w-0 flex-1"><Input label="Find a book" value={query} maxLength={200} disabled={disabled || searching}
        error={issues.find((issue) => issue.field === "workId")?.message}
        onChange={(event) => { generation.current++; setQuery(event.target.value); setSearching(false); }} /></div>
      <Button type="submit" disabled={disabled || searching || !query.trim()}>Search</Button>
    </form>
    {!options && <div className="max-h-60 space-y-1 overflow-auto" aria-label="Book search results">
      {books.map((book) => <button key={book.workId} type="button" disabled={disabled || searching}
        className="block w-full rounded-sm px-3 py-2 text-left hover:bg-glass-highlight pointer-coarse:min-h-11"
        onClick={() => void select(book.workId)}><span className="block text-sm">{book.title}</span>
        <span className="text-xs text-fg-secondary">{book.creators}</span></button>)}
    </div>}
    {options && <form className="space-y-4" onSubmit={(event) => { event.preventDefault();
      onPrepare({ action: "link", ebookId: row.id, workId: options.workId, choice, ...(locationId ? { locationId } : {}) }); }}>
      <p className="type-item-title">{options.title}</p>
      <EditionChoiceFields options={options} row={row} choice={choice} onChange={setChoice} disabled={disabled} issues={issues} />
      {choice.kind !== "fill_copy" && <ReviewCopyFields options={options} locationId={locationId} onLocation={setLocation} disabled={disabled} issues={issues} />}
      <Button variant="primary" type="submit" disabled={disabled || (choice.kind === "new_edition" && !choice.language)}>Preview link</Button>
    </form>}
    {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
  </div>;
}
