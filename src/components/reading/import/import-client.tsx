"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BookPicker } from "@/components/reading/book-picker";
import { Cover } from "@/components/reading/reading-tiles";
import {
  commitReadingImport,
  decideAllImportNotes,
  decideImportNote,
  decideImportRow,
  decideImportSection,
  rematchImport,
  undoReadingImport,
} from "@/lib/actions/reading-import";
import type { ImportDecision } from "@/lib/reading/import/match-rules";
import type { ImportNoteView } from "@/lib/reading/import/notes";
import type { RowLineKind, RowView } from "@/lib/reading/import/row-view";

/*
 * The reading import's buttons (SLN-450): small client islands on server
 * pages. Each decision is saved at once, then the page refreshes its counts.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ADDED_KEY = "durtal-import-added";
const coarse = "pointer-coarse:h-11";

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

/** The upload area: a CSV chosen or dropped goes to the route, then to its preview */
export function ImportUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/\.csv$/i.test(file.name)) return setError("Only CSV files can be imported: a Goodreads, StoryGraph or Durtal export");
    if (file.size > MAX_BYTES) return setError("This file is over 10 MB. Export a smaller one.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/reading/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { importId?: string; error?: string };
      if (!res.ok || !body.importId) throw new Error(body.error ?? "The file could not be imported");
      router.push(`/reading/import/${body.importId}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files[0]);
      }}
      data-import-upload=""
      className={`flex flex-col items-center rounded-sm border border-dashed px-6 py-10 text-center transition-colors ${
        over ? "border-accent-rose/40 bg-accent-rose/5" : "border-glass-border bg-bg-secondary"
      }`}
    >
      <div className="mb-5 rounded-sm border border-glass-border bg-bg-secondary/50 p-3.5">
        <Upload className="h-6 w-6 text-fg-muted" strokeWidth={1.5} aria-hidden />
      </div>
      <h2 className="type-item-title">Import reading history</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-fg-secondary">
        A Goodreads or StoryGraph export, or a Durtal reading CSV. You see every row and its book before anything is written.
      </p>
      <Button variant="primary" className={`mt-5 ${coarse}`} disabled={busy} onClick={() => input.current?.click()} data-import-choose="">
        {busy ? "Reading the file..." : "Choose a CSV file"}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-label="CSV file"
        data-import-file=""
        onChange={(e) => void send(e.target.files?.[0])}
      />
      {error && (
        <p role="alert" className="mt-3 max-w-md text-sm text-accent-red-text" data-import-error="">
          {error}
        </p>
      )}
      <p className="mt-5 max-w-lg text-xs leading-relaxed text-fg-secondary">
        Goodreads: My Books, Import and export, Export library. StoryGraph: Manage account, Export StoryGraph library. At most 10 MB.
      </p>
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<unknown>, done?: (result: unknown) => void) =>
    start(async () => {
      try {
        const result = await action();
        done?.(result);
        router.refresh();
      } catch (err) {
        toast.error(message(err));
      }
    });
  return { pending, run };
}

/** A row's decision, its book, its candidates, the rating choice and "Add this book" */
function RowActions({ importId, rowNo, title, actions }: { importId: string; rowNo: number; title: string; actions: NonNullable<RowView["actions"]> }) {
  const { pending, run } = useAction();
  const [current, setCurrent] = useState(actions.decision);
  const [picking, setPicking] = useState(false);
  // The page refreshed with another decision: follow it
  const [seen, setSeen] = useState(actions.decision);
  if (seen !== actions.decision) {
    setSeen(actions.decision);
    setCurrent(actions.decision);
  }
  const decide = (next: ImportDecision) => {
    setCurrent(next);
    run(() => decideImportRow({ importId, rowNo, decision: next }));
  };
  const choose = (workId: string) => run(() => decideImportRow({ importId, rowNo, workId }));
  const remember = () => {
    try {
      sessionStorage.setItem(ADDED_KEY, importId);
    } catch {}
  };
  const toggle = (label: string, value: ImportDecision) => (
    <button
      type="button"
      className="row-chip"
      data-on={current === value ? "" : undefined}
      aria-pressed={current === value}
      disabled={pending}
      onClick={() => current !== value && decide(value)}
      data-import-decide={value}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1" data-import-actions={rowNo}>
      {actions.candidates?.map((c) => (
        <button key={c.workId} type="button" className="row-chip" data-on="" disabled={pending} onClick={() => choose(c.workId)} data-import-candidate={c.workId}>
          <span className="truncate">{c.label}</span>
          <span className="text-fg-secondary">{c.score}</span>
        </button>
      ))}
      {actions.canImport && toggle(actions.anyway ? "Import anyway" : "Import", "import")}
      {(actions.canImport || actions.anyway) && toggle("Skip", "skip")}
      {actions.canChoose && (
        <button type="button" className="row-chip" disabled={pending} onClick={() => setPicking(true)} data-import-pick="">
          Choose another book
        </button>
      )}
      {actions.addHref && (
        <a href={actions.addHref} target="_blank" rel="noopener" onClick={remember} className="row-chip" data-import-add="">
          Add this book
        </a>
      )}
      {actions.ratingChoice !== undefined && (
        <label className="inline-flex h-7 cursor-pointer items-center gap-2 text-xs text-fg-secondary pointer-coarse:h-11" data-import-rating="">
          <input
            type="checkbox"
            checked={actions.ratingChoice}
            disabled={pending}
            onChange={(e) => run(() => decideImportRow({ importId, rowNo, useFileRating: e.target.checked }))}
            className="h-3.5 w-3.5 accent-accent-rose"
          />
          Use the file&rsquo;s rating
        </label>
      )}
      {picking && (
        <BookPicker
          purpose="past"
          title="Choose the book"
          initialQuery={title}
          onClose={() => setPicking(false)}
          onPick={(book) => choose(book.id)}
          addHref={(typed) => {
            remember();
            return `/library/new?${new URLSearchParams({ q: typed }).toString()}`;
          }}
        />
      )}
    </div>
  );
}

const LINE_CLASS: Record<RowLineKind, string> = {
  reason: "line-clamp-2 text-xs text-fg-secondary",
  outcome: "text-xs text-fg-primary",
  writes: "text-xs text-fg-primary",
  rating: "text-xs text-fg-secondary",
  note: "text-xs text-fg-secondary",
};
/** One section's rows: what the file says, the book, and what will happen */
export function ImportRows({ importId, rows }: { importId: string; rows: RowView[] }) {
  return (
    <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
      {rows.map((row) => (
        <li
          key={row.rowNo}
          className="grid gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-3"
          data-import-row={row.rowNo}
        >
          <div className="min-w-0">
            <p className="lines-1 text-sm text-fg-primary">{row.title}</p>
            <p className="lines-1 text-xs text-fg-secondary">{row.line}</p>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {row.book ? (
              <>
                <Cover s3Key={row.book.cover} className="h-12 w-8" />
                <div className="min-w-0">
                  {/* The title cuts off inside the link: the link's touch area is not clipped */}
                  <Link href={row.book.href} className="block text-sm text-fg-primary transition-colors hover:text-accent-rose-text touch-hit" data-import-book="">
                    <span className="lines-1">{row.book.title}</span>
                  </Link>
                  <p className="lines-1 text-xs text-fg-secondary">{row.book.line}</p>
                </div>
              </>
            ) : (
              row.empty && <p className="self-start text-xs text-fg-secondary">{row.empty}</p>
            )}
          </div>
          <div className="min-w-0 space-y-1">
            {row.lines.map(([kind, text], i) => (
              <p key={i} className={LINE_CLASS[kind]} data-import-outcome={kind === "outcome" ? "" : undefined}>
                {text}
              </p>
            ))}
            {row.actions && <RowActions importId={importId} rowNo={row.rowNo} title={row.title} actions={row.actions} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

const NOTE_STATE: Partial<Record<ImportNoteView["state"], string>> = {
  imported: "Imported",
  present: "Already in Durtal (Same source)",
  no_book: "Choose this row's book first",
};

/** One private note's Import and Skip (SLN-453) */
function NoteActions({ importId, rowNo, decision }: { importId: string; rowNo: number; decision: ImportDecision }) {
  const { pending, run } = useAction();
  const [current, setCurrent] = useState(decision);
  const [seen, setSeen] = useState(decision);
  if (seen !== decision) {
    setSeen(decision);
    setCurrent(decision);
  }
  const toggle = (label: string, value: ImportDecision) => (
    <button
      type="button"
      className="row-chip"
      data-on={current === value ? "" : undefined}
      aria-pressed={current === value}
      disabled={pending}
      onClick={() => {
        if (current === value) return;
        setCurrent(value);
        run(() => decideImportNote({ importId, rowNo, decision: value }));
      }}
      data-import-note-decide={value}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {toggle("Import", "import")}
      {toggle("Skip", "skip")}
    </div>
  );
}

/** The preview's private notes (SLN-453): the note's first lines, the row's book, and Import or Skip */
export function ImportNoteRows({ importId, rows }: { importId: string; rows: ImportNoteView[] }) {
  return (
    <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
      {rows.map((row) => {
        const state = row.state === "too_long" ? row.reason : NOTE_STATE[row.state];
        const open = row.state === "import" || row.state === "skip" || row.state === "pending";
        return (
          <li key={row.rowNo} className="grid gap-x-6 gap-y-2 px-4 py-3 lg:grid-cols-3" data-import-note={row.rowNo}>
            <div className="min-w-0">
              <p className="lines-1 text-sm text-fg-primary">{row.title}</p>
              <p className="lines-1 text-xs text-fg-secondary">{[row.author, `Row ${row.rowNo}`].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="min-w-0">
              {row.book ? (
                <>
                  {/* The title cuts off inside the link: the link's touch area is not clipped */}
                  <Link href={row.book.href} className="block text-sm text-fg-primary transition-colors hover:text-accent-rose-text touch-hit">
                    <span className="lines-1">{row.book.title}</span>
                  </Link>
                  <p className="lines-1 text-xs text-fg-secondary">{row.book.author ?? "Unknown author"}</p>
                </>
              ) : (
                <p className="text-xs text-fg-secondary">Choose this row&rsquo;s book first</p>
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <p className="whitespace-pre-line break-words text-xs text-fg-primary" data-import-note-text="">
                {row.preview}
              </p>
              {state && row.book && (
                <p className="text-xs text-fg-secondary" data-import-note-state={row.state}>
                  {state}
                </p>
              )}
              {open && row.book && <NoteActions importId={importId} rowNo={row.rowNo} decision={row.state as ImportDecision} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "Import all private notes": every note with a book (SLN-453) */
export function NotesSectionAction({ importId }: { importId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      className={coarse}
      data-import-bulk="notes"
      onClick={() =>
        run(
          () => decideAllImportNotes({ importId }),
          (r) => {
            const changed = (r as { changed: number }).changed;
            toast.success(`${changed} ${changed === 1 ? "note" : "notes"} to import`);
          },
        )
      }
    >
      Import all private notes
    </Button>
  );
}

/** "Accept all likely matches" and "Skip all not in Durtal" */
export function SectionAction({ importId, section, label }: { importId: string; section: "likely" | "none"; label: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      className={coarse}
      data-import-bulk={section}
      onClick={() =>
        run(
          () => decideImportSection({ importId, section, decision: section === "likely" ? "import" : "skip" }),
          (r) => toast.success(`${(r as { changed: number }).changed} rows changed`),
        )
      }
    >
      {label}
    </Button>
  );
}

/** "Match again", run also when the page comes back after "Add this book" */
export function MatchAgain({ importId, show }: { importId: string; show: boolean }) {
  const { pending, run } = useAction();
  const again = (quiet = false) =>
    run(
      () => rematchImport({ importId }),
      (r) => {
        const matched = (r as { matched: number }).matched;
        if (!quiet || matched) toast.message(matched ? `${matched} more ${matched === 1 ? "row" : "rows"} matched a book` : "No new matches");
      },
    );
  const latest = useRef(again);
  useEffect(() => {
    latest.current = again;
  });
  // Back from "Add this book": in this tab (the page loads again) or from another (it becomes visible)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      let added: string | null = null;
      try {
        added = sessionStorage.getItem(ADDED_KEY);
        if (added === importId) sessionStorage.removeItem(ADDED_KEY);
      } catch {}
      if (added === importId) latest.current(true);
    };
    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [importId]);
  if (!show) return null;
  return (
    <Button variant="secondary" disabled={pending} onClick={() => again()} className={coarse} data-import-rematch="">
      Match again
    </Button>
  );
}

/** The commit button, which says what it writes */
export function CommitImport({ importId, label, disabled }: { importId: string; label: string; disabled: boolean }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="primary"
      disabled={pending || disabled}
      className={coarse}
      data-import-commit=""
      onClick={() =>
        run(
          () => commitReadingImport({ importId }),
          (r) => {
            const { written, present, refused, queued, notes } = r as { written: number; present: number; refused: number; queued: number; notes: number };
            toast.success(
              [
                `${written} ${written === 1 ? "reading" : "readings"} written`,
                present ? `${present} already in Durtal` : null,
                refused ? `${refused} refused` : null,
                queued ? `${queued} ${queued === 1 ? "book" : "books"} added to Up Next` : null,
                notes ? `${notes} ${notes === 1 ? "note" : "notes"} imported` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            );
          },
        )
      }
    >
      {pending ? "Importing..." : label}
    </Button>
  );
}

/** Undo, after saying what it removes */
export function UndoImport({
  importId,
  readings,
  queued = 0,
  notes = 0,
  size = "md",
}: {
  importId: string;
  readings: number;
  queued?: number;
  notes?: number;
  size?: "sm" | "md";
}) {
  const { pending, run } = useAction();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button variant="ghost" size={size} disabled={pending} onClick={() => setAsking(true)} className={coarse} data-import-undo={importId}>
        Undo
      </Button>
      {asking && (
        <Dialog open onClose={() => setAsking(false)} title="Undo this import" className="max-w-md" expandable={false}>
          <p className="text-sm text-fg-secondary">
            This removes the {readings === 1 ? "reading" : `${readings} readings`} it wrote
            {queued ? `, the ${queued === 1 ? "book" : `${queued} books`} it added to Up Next` : ""}
            {notes ? `, the ${notes === 1 ? "note" : `${notes} notes`} it imported` : ""}, the book ratings it set while they are unchanged, and the
            Goodreads ids it recorded. Readings{notes ? " and notes" : ""} you edited since, and Up Next items you moved or edited, are kept. You can import it
            again later.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setAsking(false)} className={coarse}>
              Cancel
            </Button>
            <Button
              variant="danger"
              data-shortcut="save"
              disabled={pending}
              className={coarse}
              data-import-undo-confirm=""
              onClick={() =>
                run(
                  () => undoReadingImport({ importId }),
                  (r) => {
                    setAsking(false);
                    const { removed, kept, queueRemoved, queueKept, notesRemoved, notesKept } = r as {
                      removed: number;
                      kept: number;
                      queueRemoved: number;
                      queueKept: number;
                      notesRemoved: number;
                      notesKept: number;
                    };
                    toast.success(
                      [
                        `${removed} ${removed === 1 ? "reading" : "readings"} removed`,
                        kept ? `${kept} edited after the import and kept` : null,
                        queueRemoved ? `${queueRemoved} ${queueRemoved === 1 ? "book" : "books"} taken off Up Next` : null,
                        queueKept ? `${queueKept} Up Next ${queueKept === 1 ? "item was" : "items were"} moved or edited after the import and ${queueKept === 1 ? "was" : "were"} kept` : null,
                        notesRemoved ? `${notesRemoved} ${notesRemoved === 1 ? "note" : "notes"} removed` : null,
                        notesKept ? `${notesKept} ${notesKept === 1 ? "note was" : "notes were"} edited after the import and ${notesKept === 1 ? "was" : "were"} kept` : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    );
                  },
                )
              }
            >
              Undo the import
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
