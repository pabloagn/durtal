"use client";
import { Button, buttonClass } from "@/components/ui/button";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Dialog } from "@/components/ui/dialog";
import {
  annotationCharacterCount,
  ANNOTATION_TEXT_LIMIT,
} from "@/lib/reader/annotations";

/** Key this editor by annotation ID. A save resolves at the durable queue commit;
 * it does not wait for HTTP. Serial saves keep an older debounce behind the final
 * close save, and a failed durable write keeps the draft open for retry.
 * A note on a fresh selection is a `draft`: it saves only from Save, and its
 * mark is made then, so an abandoned note leaves nothing behind (SLN-682). */
export function NoteDialog({
  note,
  passage,
  draft = false,
  onSave,
  onClose,
}: {
  note: string | null;
  /** The marked words, shown above the note */
  passage?: string | null;
  draft?: boolean;
  onSave(note: string | null): Promise<void>;
  onClose(): void;
}) {
  if (draft) return <DraftNoteDialog passage={passage ?? null} onSave={onSave} onClose={onClose} />;
  return <SavedNoteDialog note={note} passage={passage ?? null} onSave={onSave} onClose={onClose} />;
}

/** The words a note is on, above its text: a long passage scrolls in its own box */
function Passage({ text }: { text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <blockquote
      tabIndex={0}
      aria-label="Passage"
      data-note-passage=""
      className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-glass-border pl-3 text-sm text-fg-secondary outline-none focus-visible:outline focus-visible:outline-accent-primary"
    >
      {text.trim()}
    </blockquote>
  );
}

function DraftNoteDialog({
  passage,
  onSave,
  onClose,
}: {
  passage: string | null;
  onSave(note: string | null): Promise<void>;
  onClose(): void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const count = annotationCharacterCount(text);
  const empty = !text.trim();
  // Leaving the page with words written keeps them, as a saved note's dialog does
  const pending = useRef({ text, saving, onSave });
  useLayoutEffect(() => {
    pending.current = { text, saving, onSave };
  });
  useEffect(() => {
    const hide = () => {
      const { text: value, saving: busy, onSave: persist } = pending.current;
      if (!value.trim() || busy) return;
      pending.current.saving = true;
      void persist(value).catch(() => {
        pending.current.saving = false;
      });
    };
    addEventListener("pagehide", hide);
    return () => removeEventListener("pagehide", hide);
  }, []);
  const save = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (empty || saving) return;
    setSaving(true);
    try {
      await onSave(text);
      onClose();
    } catch {
      setError("The note could not be saved. Your text is still here.");
      setSaving(false);
    }
  };
  return (
    <Dialog draft open onClose={onClose} title="Add a note" className="max-w-lg" expandable={false}>
      <form ref={form} onSubmit={(event) => void save(event)} data-reader-widget className="flex flex-col gap-3">
        <Passage text={passage} />
        <label htmlFor={id} className="type-label">
          Your note
        </label>
        <textarea
          id={id}
          value={text}
          rows={6}
          disabled={saving}
          aria-describedby={error ? id + "-error" : count >= 9000 ? id + "-count" : undefined}
          className="w-full resize-y rounded-sm border border-border-control bg-bg-secondary px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent-primary focus:glass-input-focus pointer-coarse:text-base"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (annotationCharacterCount(value) > ANNOTATION_TEXT_LIMIT) {
              setError("Use at most 10,000 characters.");
              return;
            }
            setText(value);
            setError(null);
          }}
        />
        {count >= 9000 && (
          <p id={id + "-count"} aria-live="polite" className="text-xs text-fg-secondary">
            {count.toLocaleString()} / 10,000 characters
          </p>
        )}
        {error && (
          <p id={id + "-error"} role="alert" className="text-sm text-accent-red-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button data-dismiss="" type="button" variant="ghost" onClick={onClose} className="pointer-coarse:h-11">
            Cancel
          </Button>
          <Button type="submit" variant="primary" data-shortcut="save" disabled={empty} busy={saving} className="pointer-coarse:h-11">
            Save note
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SavedNoteDialog({
  note,
  passage,
  onSave,
  onClose,
}: {
  note: string | null;
  passage: string | null;
  onSave(note: string | null): Promise<void>;
  onClose(): void;
}) {
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const id = useId();
  const latest = useRef({ text, onSave });
  useLayoutEffect(() => {
    latest.current = { text, onSave };
  });
  const saved = useRef(note ?? "");
  const chain = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const { text: value, onSave: persist } = latest.current;
    const work = chain.current
      .catch(() => {})
      .then(async () => {
        if (saved.current === value) return;
        await persist(value === "" ? null : value);
        saved.current = value;
      });
    chain.current = work;
    return work;
  }, []);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden")
        void save().catch(() =>
          setError("The note could not be saved. Your text is still here."),
        );
    };
    const hide = () => {
      void save().catch(() => {});
    };
    document.addEventListener("visibilitychange", flush);
    addEventListener("pagehide", hide);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", flush);
      removeEventListener("pagehide", hide);
    };
  }, [save]);
  const close = () => {
    if (closing) return;
    setClosing(true);
    void save().then(onClose, () => {
      setError("The note could not be saved. Try closing again.");
      setClosing(false);
    });
  };
  const count = annotationCharacterCount(text);
  return (
    <Dialog
      open
      onClose={close}
      title="Note"
      className="max-w-lg"
      expandable={false}
    >
      <div data-reader-widget className="flex flex-col gap-3">
        <Passage text={passage} />
        <label htmlFor={id} className="type-label">
          Your note
        </label>
        <textarea
          id={id}
          value={text}
          rows={8}
          disabled={closing}
          aria-describedby={
            error ? id + "-error" : count >= 9000 ? id + "-count" : undefined
          }
          className="w-full resize-y rounded-sm border border-border-control bg-bg-secondary px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent-primary focus:glass-input-focus"
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (annotationCharacterCount(value) > ANNOTATION_TEXT_LIMIT) {
              setError("Use at most 10,000 characters.");
              return;
            }
            setText(value);
            latest.current.text = value;
            setError(null);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              void save().catch(() =>
                setError(
                  "The note could not be saved. Your text is still here.",
                ),
              );
            }, 500);
          }}
        />
        {count >= 9000 && (
          <p
            id={id + "-count"}
            aria-live="polite"
            className="text-xs text-fg-secondary"
          >
            {count.toLocaleString()} / 10,000 characters
          </p>
        )}
        {error && (
          <p
            id={id + "-error"}
            role="alert"
            className="text-sm text-accent-red-text"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            disabled={closing}
            onClick={close}
            className={buttonClass("primary")}
          >
            {closing ? "Saving" : "Done"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
