"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchBooksToRead, type BookToRead } from "@/lib/actions/reading";
import { bookPickerAddHref, pickerReadingState, type PickerPurpose } from "@/lib/reading/book-picker";
import { catalogueStatusLabel } from "@/lib/utils/labels";
import { useReadingDialogs } from "./reading-dialogs-provider";

/*
 * Choose a book to start or to log a past read of (SLN-448): owned books
 * first, matched without accents; a book that is not in Durtal is one link
 * away from being added.
 */

const TITLES: Record<PickerPurpose, string> = { start: "Start a book", past: "Log a past read" };

export function BookPicker({ purpose, onClose }: { purpose: PickerPurpose; onClose: () => void }) {
  const { open } = useReadingDialogs();
  const [query, setQuery] = useState("");
  const [books, setBooks] = useState<BookToRead[] | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        searchBooksToRead(query)
          .then((rows) => live && setBooks(rows))
          .catch(() => live && setBooks([])),
      query ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  function choose(book: BookToRead) {
    onClose();
    if (purpose === "past") return void open({ kind: "past", workId: book.id });
    // Start would be refused while a reading is open: log progress on it instead
    if (book.openReadingId && book.openFingerprint)
      return void open({ kind: "progress", workId: book.id, readingId: book.openReadingId, fingerprint: book.openFingerprint });
    void open({ kind: "start", workId: book.id });
  }

  const typed = query.trim();
  const add = typed ? (
    <Link
      href={bookPickerAddHref(typed, purpose)}
      onClick={onClose}
      data-picker-add=""
      className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary pointer-coarse:h-11"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
      <span className="truncate">Not in Durtal? Add &ldquo;{typed}&rdquo;</span>
    </Link>
  ) : null;

  return (
    <Dialog open onClose={onClose} title={TITLES[purpose]} className="max-w-lg" expandable={false}>
      <div className="space-y-3">
        <Input
          aria-label="Search books"
          placeholder="Title or author"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && books?.[0]) {
              e.preventDefault();
              choose(books[0]);
            }
          }}
          autoComplete="off"
          enterKeyHint="go"
        />
        <ul className="-mx-2 max-h-[min(24rem,55dvh)] overflow-y-auto" aria-label="Books" data-picker-results="">
          {books?.map((book) => {
            const state = pickerReadingState(book);
            return (
              <li key={book.id}>
                <button
                  type="button"
                  onClick={() => choose(book)}
                  className="flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-bg-tertiary/50 focus-visible:bg-bg-tertiary/50 focus-visible:outline-none"
                >
                  <span className="h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                    {book.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/s3/read?key=${encodeURIComponent(book.cover)}`} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="lines-1 block text-sm text-fg-primary">{book.title}</span>
                    <span className="lines-1 block text-xs text-fg-secondary">
                      {[book.author, book.owned ? "Owned" : catalogueStatusLabel(book.catalogueStatus), state].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {books && books.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6" data-picker-empty="">
            <p className="text-sm text-fg-secondary">{typed ? "No book matches" : "No books yet"}</p>
            {add}
          </div>
        ) : (
          add && <div className="border-t border-glass-border pt-2">{add}</div>
        )}
      </div>
    </Dialog>
  );
}
