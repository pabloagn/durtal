"use client";

import { useState, type ReactNode } from "react";
import { Prose } from "@/components/shared/prose";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import type { NoteItem } from "@/lib/actions/reading-notes";

/*
 * One quote or note (SLN-453), as the book page, the commonplace book and
 * the hub show it: the passage in the prose serif with its line breaks (a
 * quote with a rule at its left), his thought under it, then one line of
 * where it is with the star and the menu at its right. A passage over 600
 * characters opens at 8 lines, with "Show all".
 */

/** A passage longer than this opens clamped */
const LONG = 600;

export function NoteItemView({ note, meta, controls }: { note: Pick<NoteItem, "id" | "kind" | "body" | "commentHtml">; meta: ReactNode; controls?: ReactNode }) {
  const [all, setAll] = useState(false);
  const long = note.body.length > LONG;
  const clamp = long && !all ? "line-clamp-8" : "";
  const text = <p className="whitespace-pre-line break-words">{note.body}</p>;
  return (
    <div data-note={note.id} data-note-kind={note.kind}>
      {note.kind === "quote" ? (
        <blockquote className="border-l-2 border-accent-primary/40 pl-4">
          <Prose className={clamp}>{text}</Prose>
        </blockquote>
      ) : (
        <Prose className={clamp}>{text}</Prose>
      )}
      {note.commentHtml && (
        // Sanitized on the server when it was saved (sanitizeCommentHtml)
        <div
          className={`tiptap-content mt-3 max-w-[65ch] text-sm text-fg-secondary ${note.kind === "quote" ? "pl-4.5" : ""}`}
          dangerouslySetInnerHTML={{ __html: note.commentHtml }}
          data-note-thought=""
        />
      )}
      <div className={`mt-2 flex items-start gap-3 text-xs ${note.kind === "quote" ? "pl-4.5" : ""}`}>
        <div className="min-w-0 flex-1 text-fg-secondary" data-note-meta="">
          {meta}
          {long && (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => setAll(!all)}
                className="text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
                data-note-more=""
              >
                {all ? "Show less" : "Show all"}
              </button>
            </>
          )}
        </div>
        {controls && (
          <CapAlignedControls height={32} coarseHeight={44}>
            {controls}
          </CapAlignedControls>
        )}
      </div>
    </div>
  );
}
