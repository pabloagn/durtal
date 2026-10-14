"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod/v4";
import { Button, buttonClass } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { fingerprintUploadFile } from "@/lib/ebooks/upload/browser-sha256";
import { readUploadSession, writeUploadSession, sendUploadRequest, sendUploadParts, uploadResponse, UploadHttpError, UploadFileMismatch, discardUploadRequest,
  settleUploadAdmissionRefusal, startAnotherUploadBatch, type UploadBrowserSession, type PendingUploadRequest } from "@/lib/ebooks/upload/browser-client";
import { UploadAdmissionRefusal } from "@/lib/ebooks/upload/admission-refusal";
import { uploadBatchViewSchema, uploadItemViewSchema, uploadOutcomeSchema, type UploadBatchView, type UploadItemView, type UploadItemSummary,
  type UploadTarget, type UploadCommand, type UploadOutcome, type CreateUploadBatch } from "@/lib/ebooks/upload/protocol";
import { UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";
import { formatBytes } from "@/lib/ebooks/run-text";
import { readerEntryHref } from "@/lib/reader/entry-policy";

const stateLabel: Record<UploadItemView["state"], string> = {
  queued: "Waiting for space", admitted: "Ready to send", receiving: "Sending", ready: "Received, ready to preview",
  processing: "Checking the file", quiescing: "Waiting for the server", completed: "Added", failed: "Needs attention", canceled: "Canceled", expired: "Expired",
};
const SENDING: readonly UploadItemView["state"][] = ["queued", "admitted", "receiving"];
/** Plain words for what went wrong; never a schema dump (SLN-672) */
function problem(error: unknown): string {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return "The server's answer was not understood. Reload the page and try again.";
  if (error instanceof DOMException && error.name === "AbortError") return "Paused. Choose Resume to carry on.";
  if (error instanceof DOMException && error.name === "TimeoutError") return "The server took too long to answer. Try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
/** The share of a file the server holds, in the theme's colours; a failed file shows its bar in red */
function UploadBar({ bytes, total, failed, label }: { bytes: number; total: number; failed: boolean; label: string }) {
  const percent = total ? Math.min(100, Math.round(bytes / total * 100)) : 0;
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary" data-upload-bar={failed ? "failed" : ""}>
    <div className={`h-full ${failed ? "bg-accent-red" : "bg-fg-secondary"}`} style={{ width: `${failed ? 100 : percent}%` }} />
  </div>;
}
type Preview = NonNullable<UploadOutcome["preview"]>;
export function UploadWorkbench({ target, initialBatchId, available = true }: { target: UploadTarget; initialBatchId: string | null; available?: boolean }) {
  const [session, setSession] = useState<UploadBrowserSession>({ version: 1, batchId: initialBatchId, pending: null });
  const sessionRef = useRef(session);
  const [loaded, setLoaded] = useState(false); const [batch, setBatch] = useState<UploadBatchView | null>(null);
  const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0); const [canPause, setCanPause] = useState(false);
  const [message, setMessage] = useState<string | null>(null); const [progress, setProgress] = useState<Record<string, { generation: number; bytes: number }>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({}); const abort = useRef<AbortController | null>(null);
  const refreshActive = useRef(false);
  // The files chosen on this page, by their bytes: Resume sends one again without choosing it twice
  const known = useRef(new Map<string, File>());
  const picker = useRef<HTMLInputElement>(null), reselect = useRef<HTMLInputElement>(null), reselecting = useRef<UploadItemSummary | null>(null);
  const busyRef = useRef(false);
  const persist = (next: UploadBrowserSession) => { writeUploadSession(next); sessionRef.current = next; setSession(next); };
  const refresh = useCallback(async (id = sessionRef.current.batchId) => {
    if (!id || refreshActive.current) return;
    refreshActive.current = true;
    try {
      const raw = await uploadResponse(await fetch(`/api/ebooks/uploads/${id}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000) }));
      const result = z.strictObject({ batch: uploadBatchViewSchema, ready: z.boolean() }).parse(raw);
      if (result.batch.id !== id) throw new Error("The upload batch response differs.");
      if (sessionRef.current.batchId !== id) return;
      setBatch(result.batch); setReady(result.ready);
    } finally { refreshActive.current = false; }
  }, []);
  useEffect(() => {
    try {
      const saved = readUploadSession();
      if (initialBatchId && saved.pending && saved.batchId !== initialBatchId)
        throw new Error("Resolve the saved upload request before opening another batch.");
      const restored = initialBatchId ? { ...saved, batchId: initialBatchId } : saved;
      sessionRef.current = restored; setSession(restored); setLoaded(true);
    } catch (error) { setMessage((error as Error).message); }
    return () => { abort.current?.abort(); };
  }, [initialBatchId]);
  useEffect(() => {
    if (!loaded || !session.batchId) return;
    let active = true;
    const poll = () => { setNow(Date.now()); void refresh(session.batchId).catch((error) => { if (active) { setReady(false); setMessage((error as Error).message); } }); };
    poll(); const timer = setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [loaded, session.batchId, refresh]);

  const request = async (pending: PendingUploadRequest) => {
    if (sessionRef.current.pending && JSON.stringify(sessionRef.current.pending) !== JSON.stringify(pending))
      throw new Error("Retry the saved request before starting another action.");
    persist({ ...sessionRef.current, pending });
    let raw: unknown;
    try { raw = await sendUploadRequest(pending); }
    catch (error) {
      if (error instanceof UploadAdmissionRefusal) {
        persist(settleUploadAdmissionRefusal(sessionRef.current, pending, error));
        await refresh(); // a fresh generation is read; no automatic reapply
      }
      // A refusal the server will repeat (403, 404, 503 unavailable…) unlocks the page; a lost answer stays saved
      else if (error instanceof UploadHttpError && error.definitive && JSON.stringify(sessionRef.current.pending) === JSON.stringify(pending))
        persist({ ...sessionRef.current, pending: null });
      throw error;
    }
    if (pending.kind === "create") {
      const created = uploadBatchViewSchema.parse(raw);
      if (created.key !== pending.body.key) throw new Error("The saved creation key differs.");
      persist({ ...sessionRef.current, batchId: created.id, pending: null }); setBatch(created);
      await refresh(created.id);
      return created;
    } else {
      const outcome = uploadOutcomeSchema.parse(raw);
      if (outcome.key !== pending.body.key) throw new Error("The saved request key differs.");
      persist({ ...sessionRef.current, pending: null }); setMessage(outcome.message);
      if (outcome.preview) setPreviews((current) => ({ ...current, [pending.operationId]: outcome.preview! }));
      else setPreviews((current) => { const next = { ...current }; delete next[pending.operationId]; return next; });
      await refresh();
      if (outcome.status >= 400) throw new Error(outcome.message);
      return outcome;
    }
  };
  const act = async (work: () => Promise<unknown>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setMessage(null);
    try { await work(); } catch (error) { setMessage(problem(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const command = (item: Pick<UploadItemView, "id">, input: UploadCommand) => request({ kind: "command", operationId: item.id, body: input });
  const select = (selected: File[]) => {
    if (!selected.length) return;
    if (selected.length > UPLOAD_LIMITS.filesPerBatch || target.kind !== "new" && selected.length !== 1) {
      setMessage(target.kind === "new" ? "Choose at most 50 files." : "Choose one file for this eBook."); return;
    }
    if (selected.some((file) => !file.size || file.size > UPLOAD_LIMITS.sourceBytes)) { setMessage("Each file must have something in it and be at most 4 GB."); return; }
    setFiles(selected); setMessage(null);
  };
  const create = () => act(async () => {
    const controller = new AbortController(); abort.current = controller; setCanPause(true);
    const inputs: CreateUploadBatch["files"] = [];
    try {
      for (const file of files) {
        setMessage(`Checking ${file.name}…`);
        const evidence = await fingerprintUploadFile(file, controller.signal);
        inputs.push({ name: file.name, bytes: file.size, sha256: evidence.sha256, target }); known.current.set(evidence.sha256, file);
      }
      const created = await request({ kind: "create", body: { protocol: 1, key: crypto.randomUUID(), files: inputs } });
      if (!("items" in created)) throw new Error("The upload creation response differs.");
      for (let index = 0; index < created.items.length; index++) {
        if (created.items[index].sha256 !== inputs[index]?.sha256) throw new Error("The created file order differs.");
        await performTransfer(created.items[index], files[index], controller);
      }
      setMessage(null);
    } finally { abort.current = null; setCanPause(false); }
  });
  const performTransfer = async (summary: UploadItemSummary, file: File, controller: AbortController) => {
    const raw = await uploadResponse(await fetch(`/api/ebooks/upload-operations/${summary.id}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal }));
    const item = uploadItemViewSchema.parse(raw);
    if (item.id !== summary.id || item.sha256 !== summary.sha256) throw new Error("The resumed upload identity differs.");
    setMessage(`Sending ${item.name}…`);
    await sendUploadParts(file, item, controller.signal, (bytes) => setProgress((current) => ({ ...current, [item.id]: { generation: item.generation, bytes } })),
      () => command(item, { action: "admit", key: crypto.randomUUID(), generation: item.generation }));
    await command(item, { action: "complete", key: crypto.randomUUID(), generation: item.generation, sha256: item.sha256 });
  };
  const transfer = (item: UploadItemSummary, file: File) => act(async () => {
    const controller = new AbortController(); abort.current = controller; setCanPause(true);
    known.current.set(item.sha256, file);
    try { await performTransfer(item, file, controller); setMessage(null); }
    catch (error) { if (error instanceof UploadFileMismatch) known.current.delete(item.sha256); throw error; }
    finally { abort.current = null; setCanPause(false); await refresh(); }
  });
  /** Each in turn: Preview every received file, or Confirm every preview that still holds */
  const every = (items: UploadItemSummary[], each: (item: UploadItemSummary) => Promise<unknown>) => act(async () => { for (const item of items) await each(item); });
  const blocked = busy || !loaded || !!session.pending;
  const startAnother = () => {
    if (blocked) return;
    try {
      persist(startAnotherUploadBatch(sessionRef.current));
      setFiles([]); setBatch(null); setProgress({}); setPreviews({}); setReady(false); setMessage(null); known.current.clear();
      const url = new URL(window.location.href); url.searchParams.delete('batch'); window.history.replaceState(null, '', url);
    } catch (error) { setMessage((error as Error).message); }
  };
  const holds = (item: UploadItemSummary) => !!previews[item.id] && Date.parse(previews[item.id].expiresAt) > now;
  const previewable = batch?.items.filter((item) => item.state === "ready" && !holds(item)) ?? [];
  const confirmable = batch?.items.filter(holds) ?? [];
  const returnTo = session.batchId ? `/ebooks/upload?batch=${session.batchId}` : "/ebooks/upload";
  return <div className="space-y-8">
    {!available && <p role="note" className="text-sm text-fg-secondary">Uploads are off on this server: it is running without the upload service, so no file can be sent yet.</p>}
    {message && <p role="status" aria-live="polite" className="break-words text-sm text-fg-secondary">{message}</p>}
    {session.pending && <div className="space-y-3 rounded-sm border border-border-control p-4">
      <p className="text-sm text-fg-primary">The last request got no answer, so Durtal does not know whether it worked. Send it again to find out, or discard it.</p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => void act(() => request(session.pending!))}>Send it again</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { persist(discardUploadRequest(sessionRef.current)); setMessage(null); }}>Discard request</Button>
      </div>
    </div>}
    {session.lastRefusal && <p className="text-sm text-fg-secondary">The server restarted before it took the last file, so nothing of it was lost. Choose Resume on it to send it again.</p>}
    {(busy || session.batchId) && <div className="flex flex-wrap gap-3">
      {busy && <Button variant="secondary" onClick={() => abort.current?.abort(new DOMException("Transfer paused", "AbortError"))} disabled={!canPause}>Pause</Button>}
      {session.batchId && <Button variant="secondary" disabled={blocked} onClick={startAnother}>Start another upload</Button>}
    </div>}
    {!!session.priorBatches?.length && <nav aria-label="Previous uploads" className="flex flex-wrap gap-3">
      {session.priorBatches.map((id, index) => <a key={id} className={buttonClass("secondary")} href={`/ebooks/upload?batch=${id}`}>Previous upload {index + 1}</a>)}
    </nav>}
    {!session.batchId && <section>
      <SectionHeading title="Choose files" description={target.kind === "new" ? "Up to 50 files, 4 GB each. Keep this page open while they send." : "One file, up to 4 GB. Keep this page open while it sends."} />
      <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!blocked && available) select(Array.from(event.dataTransfer.files)); }}
        className="flex flex-wrap items-center gap-3 rounded-sm border border-dashed border-border-control p-6 text-sm text-fg-secondary">
        <span>{target.kind === "new" ? "Drop eBook files here, or" : "Drop the file here, or"}</span>
        <input ref={picker} type="file" multiple={target.kind === "new"} disabled={blocked || !available} className="sr-only" tabIndex={-1} aria-label="Choose eBook files"
          onChange={(event) => { select(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <Button disabled={blocked || !available} onClick={() => picker.current?.click()}>{target.kind === "new" ? "Choose files" : "Choose a file"}</Button>
      </div>
      {files.length > 0 && <ul className="my-4 space-y-2">{files.map((file, index) => <li key={index} className="break-words text-sm text-fg-secondary">{file.name} · {formatBytes(file.size)}</li>)}</ul>}
      <Button variant="primary" className="mt-4" disabled={blocked || !available || !files.length} onClick={create}>Start upload</Button>
    </section>}
    <input ref={reselect} type="file" className="sr-only" tabIndex={-1} aria-label="Choose the file again"
      onChange={(event) => { const file = event.target.files?.[0], item = reselecting.current; event.target.value = ""; if (file && item) void transfer(item, file); }} />
    {batch && <section>
      <SectionHeading title="This upload" action={<a className={buttonClass("secondary")} href={`/ebooks/runs/${batch.runId}`}>Details</a>} />
      {!ready && <p className="mb-4 text-sm text-fg-secondary">The upload service is restarting. What was sent is kept, and you can resume once it is back.</p>}
      {(previewable.length > 1 || confirmable.length > 1) && <div className="mb-4 flex flex-wrap gap-3">
        {previewable.length > 1 && <Button disabled={blocked} onClick={() => void every(previewable, (item) => command(item, { action: "prepare", key: crypto.randomUUID() }))}>Preview all ({previewable.length})</Button>}
        {confirmable.length > 1 && <Button variant="primary" disabled={blocked} onClick={() => void every(confirmable, (item) => command(item, { action: "confirm", key: crypto.randomUUID(), previewToken: previews[item.id].token }))}>Confirm all ({confirmable.length})</Button>}
      </div>}
      <ul className="space-y-4">{batch.items.map((item) => {
        const received = item.acknowledgedBytes;
        const local = progress[item.id];
        const bytes = Math.max(received, local?.generation === item.generation ? local.bytes : 0); const preview = previews[item.id];
        const file = known.current.get(item.sha256);
        const read = item.ebookId ? readerEntryHref(`/reader/${item.ebookId}`, returnTo) : null;
        return <li key={item.id} className="min-w-0 space-y-3 rounded-sm border border-border-subtle p-4">
          <SectionHeading as="h3" title={<span className="break-words">{item.name}</span>} />
          <p className="text-sm text-fg-secondary">{stateLabel[item.state]} · {bytes >= item.bytes ? formatBytes(item.bytes) : `${formatBytes(bytes)} of ${formatBytes(item.bytes)}`}</p>
          <UploadBar bytes={bytes} total={item.bytes} failed={item.state === "failed"} label={`Sent of ${item.name}`} />
          {item.message && <p className="break-words text-sm text-fg-secondary">{item.message}</p>}
          {item.retainedUntil && SENDING.includes(item.state) && <p className="text-sm text-fg-secondary">What was sent is kept until {new Date(item.retainedUntil).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.</p>}
          <div className="flex flex-wrap gap-3">
            {item.state === "completed" && item.ebookId && <>
              <Link className={buttonClass("primary")} href={`/ebooks/${item.ebookId}`}>Open eBook</Link>
              {read && <Link className={buttonClass("secondary")} href={read}>Read</Link>}
              {item.target.kind === "new" && <Link className={buttonClass("secondary")} href={`/ebooks/${item.ebookId}#book`}>Link to a book…</Link>}
            </>}
            {SENDING.includes(item.state) && (file
              ? <Button disabled={blocked || !ready} onClick={() => void transfer(item, file)}>Resume</Button>
              : <Button disabled={blocked || !ready} onClick={() => { reselecting.current = item; reselect.current?.click(); }}>Choose the file again</Button>)}
            {item.state === "ready" && <Button disabled={blocked} onClick={() => void act(() => command(item, { action: "prepare", key: crypto.randomUUID() }))}>Preview</Button>}
            {item.state === "failed" && <Button disabled={blocked} onClick={() => void act(() => command(item, { action: "retry", key: crypto.randomUUID() }))}>Try again</Button>}
            {!["completed", "canceled", "expired"].includes(item.state) && <Button variant="secondary" disabled={blocked} onClick={() => void act(() => command(item, { action: "cancel", key: crypto.randomUUID() }))}>Cancel upload</Button>}
            {item.undoAvailable && item.originalOperationId && <Button variant="secondary" disabled={blocked} onClick={() => void act(() => command(item, { action: "undo", key: crypto.randomUUID(), originalOperationId: item.originalOperationId! }))}>Preview undo</Button>}
            {item.target.kind === "replace" && item.originalOperationId && item.currentFingerprint && <Button variant="secondary" disabled={blocked}
              onClick={() => void act(() => command(item, { action: "restore", key: crypto.randomUUID(), originalOperationId: item.originalOperationId!,
                fileId: item.target.kind === "replace" ? item.target.fileId : "", beforeFingerprint: item.currentFingerprint! }))}>Preview putting the old file back</Button>}
          </div>
          {preview && <div className="space-y-3 border-t border-border-subtle pt-3">
            <p className="break-words text-sm text-fg-primary">{preview.effect}</p>
            <p className="text-sm text-fg-secondary">{Date.parse(preview.expiresAt) <= now ? "This preview has run out. Preview again." : `This preview holds until ${new Date(preview.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}</p>
            <Button variant="primary" disabled={blocked || Date.parse(preview.expiresAt) <= now} onClick={() => void act(() => command(item, { action: "confirm", key: crypto.randomUUID(), previewToken: preview.token }))}>Confirm</Button>
          </div>}
        </li>;
      })}</ul>
      <a className={`${buttonClass("secondary")} mt-4`} href={`/ebooks/review?run=${batch.runId}`}>Review uploaded eBooks</a>
    </section>}
  </div>;
}
