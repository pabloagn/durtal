"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { prepareReviewUnlinkUi, confirmReviewUnlinkUi } from "@/lib/actions/ebook-review-unlink-ui";
import { confirmReviewUi, prepareReviewUi, readReviewStampUi, undoReviewUi } from "@/lib/actions/ebook-review-ui";
import type { ReviewUnlinkTarget, ReviewUnlinkMode, PreparedUnlinkReview } from "@/lib/ebooks/review-queue/unlink-types";
import type { ReviewOutcome } from "@/lib/ebooks/review-queue/types";

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
/** "1 copy and 2 editions": what an unlink removes, in words, leaving out what it keeps (SLN-684) */
export function removedWords(deleted: PreparedUnlinkReview["preview"]["deleted"]): string | null {
  const parts = [
    deleted.copies && counted(deleted.copies, "copy", "copies"),
    deleted.editions && counted(deleted.editions, "edition", "editions"),
    deleted.books && counted(deleted.books, "book", "books"),
    deleted.authors && counted(deleted.authors, "author", "authors"),
    deleted.series && counted(deleted.series, "series", "series"),
  ].filter((part): part is string => !!part);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
type Then = "review" | "keep";
async function keepAsEbook(ebookId: string): Promise<{ ok: true; outcome: ReviewOutcome } | { ok: false; message: string }> {
  const stamp = await readReviewStampUi({ ebookId }).catch(() => null);
  if (!stamp?.ok) return { ok: false, message: stamp && !stamp.ok ? stamp.error.message : "The eBook could not be read." };
  const prepared = await prepareReviewUi({ intent: { action: "keep", ebookId }, stamp: stamp.value }).catch(() => null);
  if (!prepared?.ok) return { ok: false, message: prepared && !prepared.ok ? prepared.error.message : "Keep as eBook could not be prepared." };
  const kept = await confirmReviewUi({ request: prepared.value.request, previewToken: prepared.value.previewToken }).catch(() => null);
  if (!kept?.ok) return { ok: false, message: kept && !kept.ok ? kept.error.message : "Keep as eBook could not be confirmed." };
  return { ok: true, outcome: kept.value };
}
export function UnlinkEbookDialog({ target, initialMode, onClose, onCommitted }: {
  target: ReviewUnlinkTarget; initialMode: ReviewUnlinkMode;
  onClose: () => void; onCommitted: (outcome: ReviewOutcome) => void;
}) {
  const [mode, setMode] = useState(initialMode), [prepared, setPrepared] = useState<PreparedUnlinkReview | null>(null);
  const [phase, setPhase] = useState<"editing" | "preparing" | "prepared" | "applying" | "unknown" | "keeping" | "committed">("editing");
  const [error, setError] = useState<string | null>(null), [outcome, setOutcome] = useState<string | null>(null);
  const [then, setThen] = useState<Then>("review");
  /** The keep that followed the unlink, while it can be undone here */
  const [kept, setKept] = useState<ReviewOutcome | null>(null), [undoing, setUndoing] = useState(false);
  const generation = useRef(0), lock = useRef(false);
  const locked = phase === "applying" || phase === "unknown" || phase === "keeping" || undoing;
  function close() { if (!locked && !lock.current) { generation.current++; onClose(); } }
  async function prepare() {
    if (locked || lock.current || phase === "preparing" || phase === "committed") return;
    const current = ++generation.current; setPhase("preparing"); setError(null);
    const result = await prepareReviewUnlinkUi({ intent: { ebookId: target.id, mode,
      originalMatchingOperation: target.matching.operation }, stamp: target.stamp }).catch(() => null);
    if (current !== generation.current) return;
    if (result?.ok) { setPrepared(result.value); setPhase("prepared"); }
    else { setPrepared(null); setPhase("editing"); setError(result && !result.ok ? result.error.message : "The unlink could not be checked. Reload the eBook and try again."); }
  }
  async function confirm() {
    if (lock.current || !prepared?.capabilities.canApply || !["prepared", "unknown"].includes(phase)) return;
    const exact = prepared; lock.current = true; setPhase("applying"); setError(null);
    const result = await confirmReviewUnlinkUi({ request: exact.request, previewToken: exact.previewToken }).catch(() => null);
    if (!result?.ok) {
      lock.current = false;
      const unknown = result === null || (!result.ok && result.error.retryOriginal);
      setPhase(unknown ? "unknown" : "editing"); if (!unknown) setPrepared(null);
      setError(result && !result.ok ? result.error.message : "Whether it was unlinked could not be confirmed. Try again: it is not unlinked twice.");
      return;
    }
    setPrepared(null); onCommitted(result.value);
    if (then === "keep" && mode === "unlink") {
      // A second decision on the eBook now back in review: it has an Undo of its own
      setPhase("keeping");
      const kept = await keepAsEbook(target.id);
      if (kept.ok) { onCommitted(kept.outcome); setKept(kept.outcome); setOutcome("Unlinked and kept as an eBook."); }
      else { setOutcome("Unlinked. It is back in review."); setError(`It could not be kept as an eBook: ${kept.message}`); }
    } else setOutcome(`${result.value.message}${result.value.keptCopy ? " The copy was kept." : ""}`);
    lock.current = false; setPhase("committed");
  }
  async function undoKeep() {
    const original = kept?.undo.originalOperation;
    if (!kept || !original || undoing) return;
    setUndoing(true); setError(null);
    const result = await undoReviewUi({ ebookId: kept.ebookId, originalOperation: original }).catch(() => null);
    setUndoing(false);
    if (result?.ok) { onCommitted(result.value); setKept(null); setOutcome("Unlinked. It is back in review."); }
    else setError(result && !result.ok ? result.error.message : "Whether the keep was undone could not be confirmed. Try again.");
  }
  const removed = prepared ? removedWords(prepared.preview.deleted) : null;
  return <Dialog open title={mode === "automatic_undo" ? `Undo the automatic link of “${target.title}”` : `Unlink “${target.title}”`}
    onClose={close} expandable={false}>
    <div className="space-y-4">
      {!outcome && <p className="text-sm text-fg-secondary">{mode === "automatic_undo"
        ? "This takes the eBook off the book it was linked to automatically. It can't if the eBook has changed since."
        : "This takes the eBook off its book. Copies and catalogue entries made only for it are removed."}</p>}
      {!outcome && mode === "unlink" && <fieldset className="space-y-2" disabled={locked}>
        <legend className="type-label mb-2">Then</legend>
        {([["review", "Return it to review", "Choose its book again later."], ["keep", "Keep it as an eBook", "It stays in the library on its own. You can undo this."]] as const)
          .map(([value, label, help]) => <label key={value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="unlink-then" value={value} checked={then === value} onChange={() => setThen(value)}
              className="mt-1" />
            <span><span className="text-fg-primary">{label}</span><span className="block text-xs text-fg-secondary">{help}</span></span>
          </label>)}
      </fieldset>}
      {prepared && <div className="space-y-2 rounded-sm border border-glass-border bg-glass-highlight p-4">
        <p className="type-label">What happens</p><p className="text-sm">{then === "keep" && mode === "unlink"
          ? prepared.preview.text.replace(/^Returns the eBook to review\./, "Takes the eBook off its book.")
          : prepared.preview.text}</p>
        {removed && <p className="text-xs text-fg-secondary">Removes {removed}.</p>}
        {prepared.preview.restoredCopy && <p className="text-xs text-fg-secondary">Puts the existing copy back where it was before the link.</p>}
        <p className="text-xs text-fg-secondary">{then === "keep" && mode === "unlink"
          ? "Then keeps it as an eBook."
          : "To link it again, choose its book in the review queue."}</p>
      </div>}
      {outcome && <p role="status" className="text-sm">{outcome}</p>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={locked} onClick={close}>{phase === "committed" ? "Done" : "Cancel"}</Button>
        {!locked && phase !== "preparing" && phase !== "committed" && mode === "automatic_undo" &&
          <Button onClick={() => { generation.current++; setMode("unlink"); setPrepared(null); setError(null); setPhase("editing"); }}>Unlink instead</Button>}
        {phase === "editing" && <Button variant="primary" onClick={() => void prepare()}>Check what changes</Button>}
        {phase === "preparing" && <Button variant="primary" disabled>Checking…</Button>}
        {prepared && <Button variant="primary" disabled={phase === "applying" || !prepared.capabilities.canApply} onClick={() => void confirm()}>
          {phase === "applying" ? "Unlinking…" : phase === "unknown" ? "Try again" : mode === "automatic_undo" ? "Undo the link" : "Unlink"}
        </Button>}
        {phase === "keeping" && <Button variant="primary" disabled>Keeping as an eBook…</Button>}
        {phase === "committed" && kept?.undo.available && <Button disabled={undoing} onClick={() => void undoKeep()}>{undoing ? "Undoing…" : "Undo keep"}</Button>}
      </div>
    </div>
  </Dialog>;
}
