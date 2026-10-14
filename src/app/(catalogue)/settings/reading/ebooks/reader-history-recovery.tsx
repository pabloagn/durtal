"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { beginReaderHistory, commitReaderHistory, finishReaderHistory, undoReaderHistory,
  type previewReaderHistory, type readerHistoryOperations } from "@/lib/actions/reader-history";

type Row = Awaited<ReturnType<typeof previewReaderHistory>>[number];
type Operation = Awaited<ReturnType<typeof readerHistoryOperations>>[number];
type Edit = { selected: boolean; status: "reading" | "paused" | "finished"; startedOn: string; finishedOn: string; percent: string };

export function ReaderHistoryRecovery({ rows, operations }: { rows: Row[]; operations: Operation[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Edit>>(() => Object.fromEntries(rows.map((row) => [row.ebookId, {
    selected: row.selected && !row.imported, status: row.reading.status as Edit["status"],
    startedOn: row.reading.startedOn ?? "", finishedOn: row.reading.finishedOn ?? "", percent: String(row.reading.position?.percent ?? 0),
  }])));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ id: string; choices: Parameters<typeof commitReaderHistory>[0]["rows"] } | null>(null);
  const change = (id: string, patch: Partial<Edit>) => setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const selected = rows.filter((row) => !row.imported && edits[row.ebookId].selected);

  async function recover() {
    if (busy) return;
    const operation = pending ?? { id: crypto.randomUUID(), choices: selected.map((row) => {
      const edit = edits[row.ebookId];
      return { ebookId: row.ebookId, fingerprint: row.fingerprint, status: edit.status,
        startedOn: edit.startedOn || null, finishedOn: edit.finishedOn || null, percent: Number(edit.percent) };
    }) };
    if (!operation.choices.length) return;
    setPending(operation);
    setBusy(true);
    setMessage("Saving reading history…");
    try {
      const started = await beginReaderHistory({ operationId: operation.id, total: operation.choices.length });
      if (started.status === "completed") {
        setPending(null);
        setMessage("This recovery already completed. Its readings have not been added twice.");
        router.refresh();
        return;
      }
      let written = 0;
      let skipped = 0;
      for (let at = 0; at < operation.choices.length; at += 100) {
        const result = await commitReaderHistory({ operationId: operation.id, rows: operation.choices.slice(at, at + 100) });
        setOutcomes((current) => ({ ...current, ...Object.fromEntries(result.map((outcome, index) => [operation.choices[at + index].ebookId,
          outcome.outcome === "written" ? "Added to Reading" : outcome.reason ?? outcome.match?.reason ?? outcome.outcome.replaceAll("_", " ")])) }));
        written += result.filter((row) => row.outcome === "written").length;
        skipped += result.filter((row) => row.outcome !== "written").length;
        setMessage(`Saved ${written} readings. ${skipped ? `${skipped} already present or skipped. ` : ""}Processing ${Math.min(at + 100, operation.choices.length)} of ${operation.choices.length}…`);
      }
      await finishReaderHistory(operation.id);
      setPending(null);
      setMessage(`Recovery complete. ${written} readings added; ${skipped} already present or skipped. You can undo this operation below.`);
      router.refresh();
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Recovery could not finish."} Saved batches remain safe. Retry to continue the same operation.`);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function undo(id: string) {
    setBusy(true);
    try {
      const removed = await undoReaderHistory(id);
      setMessage(`Removed ${removed} recovered readings. Readings edited since recovery were kept.`);
      if (pending?.id === id) setPending(null);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not undo this recovery."); }
    finally { setBusy(false); }
  }

  const field = "block min-h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-xs text-fg-primary focus:border-accent-primary focus:outline-none disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:text-sm";
  return <>
    <Link href="/settings/reading"
      className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit">
      <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
      Back to Reading settings
    </Link>
    {/* Under Settings since SLN-641: it had no app layout, so it showed unstyled */}
    <SectionHeading title="Recover eBook reading history"
      description="Review the preserved history before adding it to Reading. Blank dates stay unknown. Recovery adds no reading time, ratings, or private notes." />
    {message && <p role="status" className="mb-6 rounded-sm border border-glass-border bg-bg-secondary px-5 py-3 text-sm text-fg-primary">{message}</p>}
    {rows.length ? <form onSubmit={(event) => { event.preventDefault(); void recover(); }} className="mb-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-secondary">{selected.length} of {rows.length} selected</p>
        <Button type="submit" variant="primary" disabled={busy || (!pending && !selected.length)}>{busy ? "Saving…" : pending ? "Retry recovery" : "Add selected history"}</Button>
      </div>
      <div className="space-y-3">{rows.map((row) => {
        const edit = edits[row.ebookId];
        const disabled = busy || !!pending || row.imported;
        return <fieldset key={row.ebookId} disabled={disabled} className="rounded-sm border border-glass-border bg-bg-secondary px-5 py-4">
          <legend className="type-item-title float-left mb-2 w-full">{row.title}</legend>
          <label className="clear-both mb-3 flex min-h-8 items-center gap-2 text-sm text-fg-primary pointer-coarse:min-h-11"><input type="checkbox" checked={edit.selected}
            onChange={(event) => change(row.ebookId, { selected: event.target.checked })} />{row.imported ? "Already recovered" : "Add this history"}</label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5"><span className="type-label block">Status</span><select className={field} value={edit.status}
              onChange={(event) => change(row.ebookId, { status: event.target.value as Edit["status"] })}>
              <option value="reading">Reading</option><option value="paused">Paused</option><option value="finished">Finished</option></select></label>
            <label className="space-y-1.5"><span className="type-label block">Started · optional</span><input type="date" className={field} value={edit.startedOn}
              onChange={(event) => change(row.ebookId, { startedOn: event.target.value })} /></label>
            <label className="space-y-1.5"><span className="type-label block">Finished · optional</span><input type="date" disabled={disabled || edit.status !== "finished"}
              className={field} value={edit.finishedOn}
              onChange={(event) => change(row.ebookId, { finishedOn: event.target.value })} /></label>
            <label className="space-y-1.5"><span className="type-label block">Progress · percent</span><input type="number" min="0" max="100" step="0.01" required
              className={field} value={edit.percent}
              onChange={(event) => change(row.ebookId, { percent: event.target.value })} /></label>
          </div>
          {row.reason === "already_open" && <p className="mt-3 text-xs text-fg-secondary">This book already has an open reading. Only finished history can be added.</p>}
          {row.reason === "end_without_finish" && <p className="mt-3 text-xs text-fg-secondary">The saved position is at the end, but no finish date was preserved. Check this before selecting it.</p>}
          {row.reason === "low_or_old" && <p className="mt-3 text-xs text-fg-secondary">Low progress or older history. Check whether you want to keep it.</p>}
          {outcomes[row.ebookId] && <p className="mt-3 text-sm text-fg-primary">{outcomes[row.ebookId]}</p>}
        </fieldset>;
      })}</div>
    </form> : <p className="mb-8 text-sm text-fg-secondary">No preserved, linked eBook history is available to recover.</p>}
    {operations.length > 0 && <section>
      <SectionHeading as="h3" title="Recovery operations" />
      <div className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
        {operations.map((operation) => <div key={operation.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm text-fg-primary">
          <span>{new Date(operation.createdAt).toLocaleDateString()} · {operation.status} · {operation.processedRecords} readings</span>
          <Button disabled={busy || operation.status === "undone"} onClick={() => void undo(operation.id)}>Undo recovery</Button>
        </div>)}
      </div>
    </section>}
  </>;
}
