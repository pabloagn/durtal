"use client";
import { buttonClass } from "@/components/ui/button";
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
 * close save, and a failed durable write keeps the draft open for retry. */
export function NoteDialog({
  note,
  onSave,
  onClose,
}: {
  note: string | null;
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
          className="w-full resize-y rounded-sm border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent-primary"
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
