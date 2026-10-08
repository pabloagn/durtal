"use client";

import { useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { RichValue } from "@/components/shared/tiptap-editor";
import { createReadingNote, updateReadingNote } from "@/lib/actions/reading-notes";
import { NOTE_MAX, type NoteKind } from "@/lib/reading/constants";
import { ordinalRead } from "@/lib/reading/labels";
import { noteDefaultMode, noteEditionDefault, type EditionSource } from "@/lib/reading/note-defaults";
import { formatPageInput, joinHyphenatedLines, parsePageInput } from "@/lib/reading/notes-text";
import { showError, useCoarsePointer } from "../reading-client";
import type { ReadingDialogProps } from "../reading-provider";
import { DialogFooter } from "./fields";
import { readNumber } from "./start-reading-dialog";

// The editor loads only once the dialog shows a quote
const TiptapEditor = dynamic(() => import("@/components/shared/tiptap-editor").then((m) => m.TiptapEditor), {
  ssr: false,
  loading: () => <div className="h-[135px] rounded-sm border border-glass-border bg-bg-secondary/30" aria-hidden />,
});

const KINDS = [
  { value: "quote", label: "Quote" },
  { value: "note", label: "Note" },
] as const;

/** The hint under an empty text area on a touch screen: iOS reads a printed page with Live Text */
export const SCAN_TEXT_HINT = "To copy a printed page, tap and hold here, then Scan Text.";

const STATUS_WORDS: Record<string, string> = { reading: "reading now", paused: "paused", finished: "finished", abandoned: "abandoned" };

/** Where the reading is, as the position field shows it in this mode; empty when not known */
function readingPlace(reading: { currentPage: number | null; currentPercent: number | null } | null, percent: boolean) {
  const value = reading ? (percent ? reading.currentPercent : reading.currentPage) : null;
  return value != null ? String(value) : "";
}

/**
 * Add or edit a quote or a note (SLN-453): the passage, the edition it is
 * filed under and where it is there (page, range or front matter, or a
 * percent; chapter), the reading it belongs to, a star, and for a quote his
 * thought. Every new quote has an edition when the book has one (SLN-480).
 * Cmd+Enter saves from the text area; Enter saves from the page.
 */
export function NoteDialog({ data, request, home, onClose, changed, open }: ReadingDialogProps) {
  const editing = request.note ?? null;
  const coarse = useCoarsePointer();
  const form = useRef<HTMLFormElement>(null);
  const favouriteLabel = useId();
  const favouriteId = useId();
  const bodyId = useId();
  const hintId = useId();
  const pageHintId = useId();
  const openRow = data.rows.find((r) => r.reading.status === "reading" || r.reading.status === "paused") ?? null;
  const [kind, setKind] = useState<NoteKind>(editing?.kind ?? request.noteKind ?? "quote");
  const [body, setBody] = useState(editing?.body ?? "");
  const [readingId, setReadingId] = useState(editing ? (editing.readingId ?? "") : (request.readingId ?? openRow?.reading.id ?? ""));
  const readingOf = (id: string) => data.rows.find((r) => r.reading.id === id)?.reading ?? null;
  const reading = readingOf(readingId);
  // The edition defaults as Start reading's do: the "I'm at" home and the last reading's edition
  const homeId = home === "none" ? null : (home ?? data.homes[0]?.id ?? null);
  const lastReadingEditionId = data.rows.find((r) => r.reading.editionId)?.reading.editionId ?? null;
  const editionDefault = (readingEditionId: string | null, callerEditionId: string | null = null) =>
    noteEditionDefault(data.editions, { callerEditionId, readingEditionId, homeId, lastReadingEditionId });
  const [initial] = useState(() => {
    if (editing) return { editionId: editing.editionId, source: "stored" as EditionSource };
    return editionDefault(reading?.editionId ?? null, request.editionId ?? null);
  });
  const [editionId, setEditionId] = useState(initial.editionId ?? "");
  const [editionSource, setEditionSource] = useState<EditionSource>(initial.source);
  const edition = data.editions.find((e) => e.id === editionId) ?? null;
  // The note is on the reading's own edition; a book with no edition listed has no field to differ
  const onEdition = (r: typeof reading, id: string | null) => !!r && (data.editions.length === 0 || r.editionId === id);
  // Page or Percent: an edit keeps the stored shape; an add follows noteDefaultMode
  const [byPercent, setByPercent] = useState(() =>
    editing
      ? editing.page == null && editing.percent != null
      : noteDefaultMode({ request, readingUnit: reading?.unit ?? null, onReadingEdition: onEdition(reading, initial.editionId ?? null) }) === "percent",
  );
  const [position, setPosition] = useState(() => {
    if (editing) return editing.page != null ? formatPageInput(editing) : editing.percent != null ? String(editing.percent) : "";
    if (request.percent !== undefined) return request.percent != null ? String(request.percent) : "";
    if (request.page != null) return String(request.page);
    // Where the reading is, only while the edition is the reading's own
    return onEdition(reading, initial.editionId ?? null) ? readingPlace(reading, byPercent) : "";
  });
  // The value the dialog filled in, while it is still there: an edition change clears it, never what he typed
  const [filled, setFilled] = useState<string | null>(() => (editing ? null : position));
  const [chapter, setChapter] = useState(editing?.chapter ?? reading?.currentChapter ?? "");
  const [favourite, setFavourite] = useState(editing?.isFavourite ?? false);
  const [thought, setThought] = useState<RichValue | null>(
    editing?.commentHtml ? { html: editing.commentHtml, json: editing.commentJson ?? null } : null,
  );
  // An edit sends the thought only once the editor changed it: the lists send no commentJson, and a page-only edit must keep it
  const [thoughtEdited, setThoughtEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  /** A new edition; the place clears when it still holds what the dialog filled in, and its mode is worked out again */
  function changeEdition(next: string, source: EditionSource, readingNow = reading) {
    setEditionId(next);
    setEditionSource(source);
    if (filled === null || position !== filled) return;
    const percent = noteDefaultMode({ request: {}, readingUnit: readingNow?.unit ?? null, onReadingEdition: onEdition(readingNow, next || null) }) === "percent";
    setByPercent(percent);
    setPosition("");
    setFilled("");
  }

  /** Another reading: the edition follows it only while it holds a default */
  function chooseReading(id: string) {
    setReadingId(id);
    if (editionSource !== "reading" && editionSource !== "default") return;
    const next = editionDefault(readingOf(id)?.editionId ?? null);
    if ((next.editionId ?? "") !== editionId) changeEdition(next.editionId ?? "", next.source, readingOf(id));
    else setEditionSource(next.source);
  }

  const number = position.trim() ? readNumber(position) : null;
  const pageInput = byPercent ? null : parsePageInput(position);
  const positionError = byPercent
    ? position.trim() && (number === null || number > 100)
      ? "A percent from 0 to 100"
      : null
    : pageInput && !pageInput.ok
      ? pageInput.error
      : null;
  // The edition's page count as a hint, never a refusal: counts from metadata are often wrong
  const lastPage = pageInput?.ok && !pageInput.value.pageRoman ? (pageInput.value.endPage ?? pageInput.value.page) : null;
  const pageHint =
    !byPercent && edition?.pageCount
      ? lastPage != null && lastPage > edition.pageCount
        ? `This edition has ${edition.pageCount} pages`
        : `Of ${edition.pageCount} pages`
      : null;
  const close = () => (request.back ? open(request.back) : onClose());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || positionError) return;
    setSaving(true);
    // A page sends no percent: the server takes it from the page and the edition's total
    const place = pageInput?.ok ? pageInput.value : { page: null, endPage: null, pageRoman: false };
    const where = byPercent ? { percent: number, page: null } : place;
    const comment = kind === "quote" && thought ? { commentHtml: thought.html, commentJson: thought.json } : { commentHtml: null, commentJson: null };
    try {
      if (editing) {
        await updateReadingNote({
          id: editing.id,
          kind,
          body,
          readingId: readingId || null,
          editionId: editionId || null,
          ...where,
          chapter: chapter.trim() || null,
          isFavourite: favourite,
          ...(thoughtEdited ? comment : {}),
        });
        toast.success("Saved");
      } else {
        await createReadingNote({
          workId: data.workId,
          kind,
          body,
          readingId: readingId || null,
          editionId: editionId || null,
          ...where,
          chapter: chapter.trim() || null,
          isFavourite: favourite,
          ...(kind === "quote" && thought ? comment : {}),
        });
        toast.success(kind === "quote" ? "Quote added" : "Note added");
      }
      changed();
      close();
    } catch (err) {
      showError(err, changed);
    } finally {
      setSaving(false);
    }
  }

  const noun = kind === "quote" ? "quote" : "note";
  return (
    <Dialog open onClose={close} title={editing ? `Edit ${noun}` : `Add a ${noun}`} description={data.workTitle} className="max-w-lg">
      <form ref={form} onSubmit={save} className="space-y-4" data-note-dialog="">
        <SegmentedControl options={KINDS} value={kind} onChange={setKind} ariaLabel="Quote or note" />
        <div className="space-y-1.5">
          <label htmlFor={bodyId} className="type-label block">
            {kind === "quote" ? "Passage" : "Note"}
          </label>
          <textarea
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={(e) => {
              // A page pasted from a book or a scan: words broken over two lines join up
              const pasted = e.clipboardData.getData("text/plain");
              const joined = joinHyphenatedLines(pasted);
              if (joined === pasted) return;
              e.preventDefault();
              const t = e.currentTarget;
              setBody(t.value.slice(0, t.selectionStart) + joined + t.value.slice(t.selectionEnd));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                form.current?.requestSubmit();
              }
            }}
            rows={coarse ? 5 : 7}
            maxLength={NOTE_MAX}
            autoFocus={!coarse}
            aria-describedby={coarse && !body ? hintId : undefined}
            placeholder={kind === "quote" ? "The words as the book has them" : "Your note"}
            className="w-full rounded-sm border border-glass-border bg-bg-primary px-3 py-2 text-sm text-fg-primary transition-colors placeholder:text-fg-muted focus:border-accent-primary focus:outline-none pointer-coarse:text-base"
            data-note-body=""
          />
          {coarse && !body && (
            <p id={hintId} className="text-xs text-fg-secondary" data-note-scan-hint="">
              {SCAN_TEXT_HINT}
            </p>
          )}
        </div>
        {/* The printing in his hands, whose pages the place uses: no "none" on an add (SLN-480) */}
        {data.editions.length > 0 && (
          <Select
            label="Edition"
            value={editionId}
            onChange={(e) => changeEdition(e.target.value, "manual")}
            className="pointer-coarse:h-11"
            options={[
              ...(editing && !editing.editionId ? [{ value: "", label: "Not recorded" }] : []),
              ...data.editions.map((ed) => ({ value: ed.id, label: ed.label })),
            ]}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Input
              label={byPercent ? "Percent" : "Page"}
              // Text, not the numeric keypad: a range (212-13) and roman pages (xiv) need a hyphen and letters
              inputMode={byPercent ? "decimal" : "text"}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              error={positionError ?? undefined}
              aria-describedby={!positionError && pageHint ? pageHintId : undefined}
              placeholder={byPercent ? undefined : "212, 212-13, xiv"}
              // 16px on touch: iOS Safari zooms into a smaller field on focus
              className="pointer-coarse:h-11 pointer-coarse:text-base"
              data-note-position=""
            />
            {!positionError && pageHint && (
              <p id={pageHintId} className="text-xs text-fg-secondary" data-note-page-hint="">
                {pageHint}
              </p>
            )}
          </div>
          <Input label="Chapter" value={chapter} onChange={(e) => setChapter(e.target.value)} maxLength={300} className="pointer-coarse:h-11 pointer-coarse:text-base" />
        </div>
        {data.rows.length > 0 && (
          <Select
            label="Reading"
            value={readingId}
            onChange={(e) => chooseReading(e.target.value)}
            className="pointer-coarse:h-11"
            options={[
              { value: "", label: "None" },
              ...data.rows.map((r) => ({
                value: r.reading.id,
                // With more than one edition, the reading's names its own: "2nd read · Penguin Classics, 2003 · reading now"
                label: [
                  ordinalRead(r.ordinal),
                  data.editions.length > 1 ? data.editions.find((ed) => ed.id === r.reading.editionId)?.short : null,
                  STATUS_WORDS[r.reading.status],
                ]
                  .filter(Boolean)
                  .join(" · "),
              })),
            ]}
          />
        )}
        {kind === "quote" && (
          <TiptapEditor
            label="Your thought"
            value={thought}
            onChange={(value) => {
              setThought(value);
              setThoughtEdited(true);
            }}
            placeholder="Why it stayed with you"
          />
        )}
        {/* The words toggle the switch too: a 44px row on touch */}
        <div className="flex items-center gap-2">
          <Switch id={favouriteId} checked={favourite} onCheckedChange={setFavourite} aria-labelledby={favouriteLabel} />
          <label id={favouriteLabel} htmlFor={favouriteId} className="flex cursor-pointer items-center text-sm text-fg-secondary pointer-coarse:min-h-11">
            Favourite
          </label>
        </div>
        <DialogFooter onCancel={close} saving={saving} saveLabel={editing ? "Save" : "Add"} disabled={!body.trim() || !!positionError} />
      </form>
    </Dialog>
  );
}
