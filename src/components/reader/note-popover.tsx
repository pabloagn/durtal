"use client";
import { useEffect, useRef } from "react";
import type { ReaderEngine, ReaderNote } from "@/lib/reader/engine";
import {
  classifyReaderLink,
  EXTERNAL_WINDOW_FEATURES,
} from "@/lib/reader/links/policy";
import { AnchoredReaderPopover } from "./anchored-reader-popover";

export function NotePopover({
  note,
  engine,
  onNavigate,
  onClose,
}: {
  note: ReaderNote;
  engine: ReaderEngine;
  onNavigate(
    href: string,
    source: "link" | "footnote",
    originMark?: string,
  ): Promise<unknown>;
  onClose(): void;
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    root.replaceChildren(note.content.cloneNode(true));
    return () => root.replaceChildren();
  }, [note]);
  return (
    <AnchoredReaderPopover
      title={note.kind}
      anchor={note.anchor}
      keyboard={note.keyboard}
      reference={note.reference}
      onClose={onClose}
      action={
        <button
          type="button"
          className="min-h-8 px-2 font-sans text-sm text-accent-blue-text pointer-coarse:min-h-11"
          onClick={() => {
            onClose();
            void onNavigate(note.href, "footnote", note.originMark);
          }}
        >
          Go to note
        </button>
      }
    >
      {note.fontFaces && <style>{note.fontFaces}</style>}
      <div
        ref={body}
        style={{ fontFamily: note.fontFamily }}
        onClick={(event) => {
          const a = (event.target as Element).closest<HTMLAnchorElement>(
            "a[href]",
          );
          if (!a) return;
          event.preventDefault();
          const policy = classifyReaderLink(a.getAttribute("href") ?? "");
          if (policy.kind === "external") {
            window.open(policy.href, "_blank", EXTERNAL_WINDOW_FEATURES);
            return;
          }
          if (policy.kind !== "internal") return;
          void engine
            .showNote?.(policy.href, {
              reference: a,
              originMark: note.originMark,
              keyboard: event.detail === 0,
            })
            .then((shown) => {
              if (!shown) {
                onClose();
                void onNavigate(policy.href, "link", note.originMark);
              }
            });
        }}
      />
    </AnchoredReaderPopover>
  );
}
