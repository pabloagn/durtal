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
import { joinHyphenatedLines } from "@/lib/reading/notes-text";
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

/**
 * Add or edit a quote or a note (SLN-453): the passage, where it is (page or
 * percent, chapter), the reading it belongs to, a star, and for a quote his
 * thought. Cmd+Enter saves from the text area; Enter saves from the page.
 */
export function NoteDialog({ data, request, onClose, changed, open }: ReadingDialogProps) {
  const editing = request.note ?? null;
  const coarse = useCoarsePointer();
  const form = useRef<HTMLFormElement>(null);
  const favouriteLabel = useId();
  const favouriteId = useId();
  const bodyId = useId();
  const hintId = useId();
  const openRow = data.rows.find((r) => r.reading.status === "reading" || r.reading.status === "paused") ?? null;
  const [kind, setKind] = useState<NoteKind>(editing?.kind ?? request.noteKind ?? "quote");
  const [body, setBody] = useState(editing?.body ?? "");
  const [readingId, setReadingId] = useState(editing ? (editing.readingId ?? "") : (request.readingId ?? openRow?.reading.id ?? ""));
  const reading = data.rows.find((r) => r.reading.id === readingId)?.reading ?? null;
  // A reading counted in percent or time takes a percent; pages otherwise
  const byPercent = editing ? editing.page == null && editing.percent != null : !!reading && reading.unit !== "pages";
  const [position, setPosition] = useState(() => {
    if (editing) return String(editing.page ?? editing.percent ?? "");
    if (request.page != null) return String(request.page);
    if (!reading) return "";
    const value = byPercent ? reading.currentPercent : reading.currentPage;
    return value != null ? String(value) : "";
  });
  const [chapter, setChapter] = useState(editing?.chapter ?? reading?.currentChapter ?? "");
  const [favourite, setFavourite] = useState(editing?.isFavourite ?? false);
  const [thought, setThought] = useState<RichValue | null>(
    editing?.commentHtml ? { html: editing.commentHtml, json: editing.commentJson ?? null } : null,
  );
  const [saving, setSaving] = useState(false);

  const number = position.trim() ? readNumber(position) : null;
  const positionError =
    position.trim() && (number === null || (byPercent ? number > 100 : !Number.isInteger(number)))
      ? byPercent
        ? "A percent from 0 to 100"
        : "A page number"
      : null;
  const close = () => (request.back ? open(request.back) : onClose());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || positionError) return;
    setSaving(true);
    // A page sends no percent: the server takes it from the page and the total
    const where = byPercent ? { percent: number, page: null } : { page: number };
    const comment = kind === "quote" && thought ? { commentHtml: thought.html, commentJson: thought.json } : { commentHtml: null, commentJson: null };
    try {
      if (editing) {
        await updateReadingNote({
          id: editing.id,
          kind,
          body,
          readingId: readingId || null,
          ...where,
          chapter: chapter.trim() || null,
          isFavourite: favourite,
          ...comment,
        });
        toast.success("Saved");
      } else {
        await createReadingNote({
          workId: data.workId,
          kind,
          body,
          readingId: readingId || null,
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
            className="w-full rounded-sm border border-glass-border bg-bg-primary px-3 py-2 text-sm text-fg-primary transition-colors placeholder:text-fg-muted focus:border-accent-rose focus:outline-none pointer-coarse:text-base"
            data-note-body=""
          />
          {coarse && !body && (
            <p id={hintId} className="text-xs text-fg-secondary" data-note-scan-hint="">
              {SCAN_TEXT_HINT}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={byPercent ? "Percent" : "Page"}
            inputMode={byPercent ? "decimal" : "numeric"}
            enterKeyHint="done"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            error={positionError ?? undefined}
            // 16px on touch: iOS Safari zooms into a smaller field on focus
            className="pointer-coarse:h-11 pointer-coarse:text-base"
            data-note-position=""
          />
          <Input label="Chapter" value={chapter} onChange={(e) => setChapter(e.target.value)} maxLength={300} className="pointer-coarse:h-11 pointer-coarse:text-base" />
        </div>
        {data.rows.length > 0 && (
          <Select
            label="Reading"
            value={readingId}
            onChange={(e) => setReadingId(e.target.value)}
            className="pointer-coarse:h-11"
            options={[
              { value: "", label: "None" },
              ...data.rows.map((r) => ({
                value: r.reading.id,
                label: `${ordinalRead(r.ordinal)}${STATUS_WORDS[r.reading.status] ? ` · ${STATUS_WORDS[r.reading.status]}` : ""}`,
              })),
            ]}
          />
        )}
        {kind === "quote" && (
          <TiptapEditor label="Your thought" value={thought} onChange={setThought} placeholder="Why it stayed with you" />
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
