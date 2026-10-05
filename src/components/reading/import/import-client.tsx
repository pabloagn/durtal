"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BookPicker } from "@/components/reading/book-picker";
import { commitReadingImport, decideImportRow, decideImportSection, rematchImport, undoReadingImport } from "@/lib/actions/reading-import";
import type { ImportDecision } from "@/lib/reading/import/match-rules";

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
      <p className="mt-5 max-w-md text-xs leading-relaxed text-fg-secondary">
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

export interface CandidateChoice {
  workId: string;
  label: string;
  score: string;
}

/** A row's decision, its book, its candidates, the rating choice and "Add this book" */
export function ImportRowActions({
  importId,
  rowNo,
  title,
  decision,
  canImport,
  anyway,
  canChoose,
  candidates,
  ratingChoice,
  addHref,
}: {
  importId: string;
  rowNo: number;
  title: string;
  decision: ImportDecision;
  canImport: boolean;
  /** "Already in Durtal" only through the undated count */
  anyway: boolean;
  canChoose: boolean;
  candidates: CandidateChoice[];
  ratingChoice: { checked: boolean } | null;
  addHref: string | null;
}) {
  const { pending, run } = useAction();
  const [current, setCurrent] = useState(decision);
  const [picking, setPicking] = useState(false);
  useEffect(() => setCurrent(decision), [decision]);
  const decide = (next: ImportDecision) => {
    setCurrent(next);
    run(() => decideImportRow({ importId, rowNo, decision: next }));
  };
  const choose = (workId: string) => run(() => decideImportRow({ importId, rowNo, workId }));
  const toggle = (label: string, value: ImportDecision) => (
    <Button
      size="sm"
      variant={current === value ? "secondary" : "ghost"}
      aria-pressed={current === value}
      disabled={pending}
      onClick={() => current !== value && decide(value)}
      className={coarse}
      data-import-decide={value}
    >
      {label}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2" data-import-actions={rowNo}>
      {candidates.map((c) => (
        <Button key={c.workId} size="sm" variant="secondary" disabled={pending} onClick={() => choose(c.workId)} className={`max-w-full ${coarse}`} data-import-candidate={c.workId}>
          <span className="truncate">{c.label}</span>
          <span className="text-fg-secondary">{c.score}</span>
        </Button>
      ))}
      {canImport && toggle(anyway ? "Import anyway" : "Import", "import")}
      {(canImport || anyway) && toggle("Skip", "skip")}
      {canChoose && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPicking(true)} className={coarse} data-import-pick="">
          Choose another book
        </Button>
      )}
      {addHref && (
        <a
          href={addHref}
          target="_blank"
          rel="noopener"
          onClick={() => {
            try {
              sessionStorage.setItem(ADDED_KEY, importId);
            } catch {}
          }}
          className={`${buttonClass("ghost", "sm")} ${coarse}`}
          data-import-add=""
        >
          Add this book
        </a>
      )}
      {ratingChoice && (
        <label className="inline-flex h-7 cursor-pointer items-center gap-2 text-xs text-fg-secondary pointer-coarse:h-11" data-import-rating="">
          <input
            type="checkbox"
            checked={ratingChoice.checked}
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
            try {
              sessionStorage.setItem(ADDED_KEY, importId);
            } catch {}
            return `/library/new?${new URLSearchParams({ q: typed }).toString()}`;
          }}
        />
      )}
    </div>
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
  latest.current = again;
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
            const { written, present, refused } = r as { written: number; present: number; refused: number };
            toast.success(
              [`${written} ${written === 1 ? "reading" : "readings"} written`, present ? `${present} already in Durtal` : null, refused ? `${refused} refused` : null]
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
export function UndoImport({ importId, readings, size = "md" }: { importId: string; readings: number; size?: "sm" | "md" }) {
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
            This removes the {readings === 1 ? "reading" : `${readings} readings`} it wrote, the book ratings it set while they are unchanged, and the
            Goodreads ids it recorded. Readings you edited since are kept. You can import it again later.
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
                    const { removed, kept } = r as { removed: number; kept: number };
                    toast.success(
                      [`${removed} ${removed === 1 ? "reading" : "readings"} removed`, kept ? `${kept} edited after the import and kept` : null].filter(Boolean).join(" · "),
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
