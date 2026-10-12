"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod/v4";
import { Button, buttonClass } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { fingerprintUploadFile } from "@/lib/ebooks/upload/browser-sha256";
import { readUploadSession, writeUploadSession, sendUploadRequest, sendUploadParts, uploadResponse,
  settleUploadAdmissionRefusal, startAnotherUploadBatch, type UploadBrowserSession, type PendingUploadRequest } from "@/lib/ebooks/upload/browser-client";
import { UploadAdmissionRefusal } from "@/lib/ebooks/upload/admission-refusal";
import { uploadBatchViewSchema, uploadItemViewSchema, uploadOutcomeSchema, type UploadBatchView, type UploadItemView, type UploadItemSummary,
  type UploadTarget, type UploadCommand, type UploadOutcome, type CreateUploadBatch } from "@/lib/ebooks/upload/protocol";
import { UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";

const sizeLabel = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const stateLabel: Record<UploadItemView["state"], string> = {
  queued: "Waiting for space", admitted: "Ready to transfer", receiving: "Transferring", ready: "Ready for inspection",
  processing: "Inspecting", quiescing: "Recovering", completed: "Saved", failed: "Needs attention", canceled: "Canceled", expired: "Expired",
};
type Preview = NonNullable<UploadOutcome["preview"]>;
export function UploadWorkbench({ target, initialBatchId }: { target: UploadTarget; initialBatchId: string | null }) {
  const [session, setSession] = useState<UploadBrowserSession>({ version: 1, batchId: initialBatchId, pending: null });
  const sessionRef = useRef(session);
  const [loaded, setLoaded] = useState(false); const [batch, setBatch] = useState<UploadBatchView | null>(null);
  const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0); const [canPause, setCanPause] = useState(false);
  const [message, setMessage] = useState<string | null>(null); const [progress, setProgress] = useState<Record<string, { generation: number; bytes: number }>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({}); const abort = useRef<AbortController | null>(null);
  const refreshActive = useRef(false);
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
    try { await work(); } catch (error) { setMessage((error as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const command = (item: Pick<UploadItemView, "id">, input: UploadCommand) => request({ kind: "command", operationId: item.id, body: input });
  const select = (selected: File[]) => {
    if (!selected.length) return;
    if (selected.length > UPLOAD_LIMITS.filesPerBatch || target.kind !== "new" && selected.length !== 1) {
      setMessage(target.kind === "new" ? "Choose at most 50 files." : "Choose one file for this eBook."); return;
    }
    if (selected.some((file) => !file.size || file.size > UPLOAD_LIMITS.sourceBytes)) { setMessage("Each file must contain data and be no larger than 4 GiB."); return; }
    setFiles(selected); setMessage(null);
  };
  const create = () => act(async () => {
    const controller = new AbortController(); abort.current = controller; setCanPause(true);
    const inputs: CreateUploadBatch["files"] = [];
    try {
      for (const file of files) {
        setMessage(`Checking ${file.name}…`);
        const evidence = await fingerprintUploadFile(file, controller.signal);
        inputs.push({ name: file.name, bytes: file.size, sha256: evidence.sha256, target });
      }
      const created = await request({ kind: "create", body: { protocol: 1, key: crypto.randomUUID(), files: inputs } });
      if (!("items" in created)) throw new Error("The upload creation response differs.");
      for (let index = 0; index < created.items.length; index++) {
        if (created.items[index].sha256 !== inputs[index]?.sha256) throw new Error("The created file order differs.");
        await performTransfer(created.items[index], files[index], controller);
      }
    } finally { abort.current = null; setCanPause(false); }
  });
  const performTransfer = async (summary: UploadItemSummary, file: File, controller: AbortController) => {
    const raw = await uploadResponse(await fetch(`/api/ebooks/upload-operations/${summary.id}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal }));
    const item = uploadItemViewSchema.parse(raw);
    if (item.id !== summary.id || item.sha256 !== summary.sha256) throw new Error("The resumed upload identity differs.");
    setMessage(`Checking retained bytes for ${item.name}…`);
    await sendUploadParts(file, item, controller.signal, (bytes) => setProgress((current) => ({ ...current, [item.id]: { generation: item.generation, bytes } })),
      () => command(item, { action: "admit", key: crypto.randomUUID(), generation: item.generation }));
    await command(item, { action: "complete", key: crypto.randomUUID(), generation: item.generation, sha256: item.sha256 });
  };
  const transfer = (item: UploadItemSummary, file: File) => act(async () => {
    const controller = new AbortController(); abort.current = controller; setCanPause(true);
    try { await performTransfer(item, file, controller); }
    finally { abort.current = null; setCanPause(false); await refresh(); }
  });
  const blocked = busy || !loaded || !!session.pending;
  const startAnother = () => {
    if (blocked) return;
    try {
      persist(startAnotherUploadBatch(sessionRef.current));
      setFiles([]); setBatch(null); setProgress({}); setPreviews({}); setReady(false); setMessage(null);
      const url = new URL(window.location.href); url.searchParams.delete('batch'); window.history.replaceState(null, '', url);
    } catch (error) { setMessage((error as Error).message); }
  };
  return <div className="space-y-8">
    {message && <p role="status" aria-live="polite" className="break-words text-sm text-fg-secondary">{message}</p>}
    {session.pending && <div className="space-y-3 border border-border-control p-4">
      <p className="text-sm text-fg-primary">A request is waiting for a confirmed response. Retry it to recover the original result.</p>
      <Button disabled={busy} onClick={() => void act(() => request(session.pending!))}>Retry saved request</Button>
    </div>}
    {busy && <Button variant="secondary" onClick={() => abort.current?.abort(new DOMException("Transfer paused", "AbortError"))} disabled={!canPause}>Pause transfer</Button>}
    {session.lastRefusal && <p className="text-xs text-fg-secondary">Admission for generation {session.lastRefusal.generation} was refused after worker recovery. The original request is recorded; choose a fresh action below.</p>}
    {session.batchId && <Button variant="secondary" disabled={blocked} onClick={startAnother}>Start another upload</Button>}
    {!!session.priorBatches?.length && <nav aria-label="Previous upload batches" className="flex flex-wrap gap-3">
      {session.priorBatches.map((id, index) => <a key={id} className={buttonClass('secondary')} href={`/ebooks/upload?batch=${id}`}>Previous upload {index + 1}</a>)}
    </nav>}
    {!session.batchId && <section>
      <SectionHeading title="Choose files" description="Up to 50 files, 4 GiB each. Keep this page open while transferring." />
      <label onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!blocked) select(Array.from(event.dataTransfer.files)); }}
        className="block space-y-3 rounded-sm border border-border-control p-6 text-sm text-fg-secondary">
        <span>Drop files here or choose them from your device.</span>
        <input type="file" multiple={target.kind === "new"} disabled={blocked} className="block max-w-full text-xs pointer-coarse:min-h-11" aria-label="Choose eBook files"
          onChange={(event) => select(Array.from(event.target.files ?? []))} />
      </label>
      {files.length > 0 && <ul className="my-4 space-y-2">{files.map((file, index) => <li key={index} className="break-words text-xs text-fg-secondary">{file.name} · {sizeLabel(file.size)}</li>)}</ul>}
      <Button variant="primary" className="mt-4" disabled={blocked || !files.length} onClick={create}>Start upload</Button>
    </section>}
    {batch && <section>
      <SectionHeading title="This upload" action={<a className={buttonClass("secondary")} href={`/ebooks/runs/${batch.runId}`}>View run</a>} />
      {!ready && <p className="mb-4 text-sm text-fg-secondary">Transfers are waiting for the worker to recover. Saved parts stay available for resume.</p>}
      <ul className="space-y-4">{batch.items.map((item) => {
        const received = item.acknowledgedBytes;
        const local = progress[item.id];
        const bytes = Math.max(received, local?.generation === item.generation ? local.bytes : 0); const preview = previews[item.id];
        return <li key={item.id} className="min-w-0 space-y-3 rounded-sm border border-border-subtle p-4">
          <SectionHeading as="h3" title={<span className="break-words">{item.name}</span>} />
          <p className="text-xs text-fg-secondary">{stateLabel[item.state]} · {sizeLabel(bytes)} of {sizeLabel(item.bytes)}</p>
          <progress value={bytes} max={item.bytes} aria-label={`Saved upload bytes for ${item.name}`} className="block h-2 w-full accent-accent-primary" />
          {item.message && <p className="break-words text-sm text-fg-secondary">{item.message}</p>}
          {item.retainedUntil && <p className="text-xs text-fg-secondary">Retained until {new Date(item.retainedUntil).toLocaleString()}.</p>}
          <div className="flex flex-wrap gap-3">
            {["queued", "admitted", "receiving"].includes(item.state) && <label className="space-y-1 text-xs text-fg-secondary">
              <span className="block">Reselect the original file to resume</span><input type="file" disabled={blocked || !ready} className="max-w-full"
                aria-label={`Select original bytes for ${item.name}`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void transfer(item, file); event.target.value = ""; }} />
            </label>}
            {item.state === "ready" && <Button disabled={blocked} onClick={() => void act(() => command(item, { action: "prepare", key: crypto.randomUUID() }))}>Preview changes</Button>}
            {item.state === "failed" && <Button disabled={blocked} onClick={() => void act(() => command(item, { action: "retry", key: crypto.randomUUID() }))}>Retry processing</Button>}
            {!["completed", "canceled", "expired"].includes(item.state) && <Button variant="secondary" disabled={blocked} onClick={() => void act(() => command(item, { action: "cancel", key: crypto.randomUUID() }))}>Cancel upload</Button>}
            {item.undoAvailable && item.originalOperationId && <Button variant="secondary" disabled={blocked} onClick={() => void act(() => command(item, { action: "undo", key: crypto.randomUUID(), originalOperationId: item.originalOperationId! }))}>Preview undo</Button>}
            {item.target.kind === "replace" && item.originalOperationId && item.currentFingerprint && <Button variant="secondary" disabled={blocked}
              onClick={() => void act(() => command(item, { action: "restore", key: crypto.randomUUID(), originalOperationId: item.originalOperationId!,
                fileId: item.target.kind === "replace" ? item.target.fileId : "", beforeFingerprint: item.currentFingerprint! }))}>Preview restore</Button>}
          </div>
          {preview && <div className="space-y-3 border-t border-border-subtle pt-3">
            <p className="break-words text-sm text-fg-primary">{preview.effect}</p>
            <p className="text-xs text-fg-secondary">Preview expires {new Date(preview.expiresAt).toLocaleString()}.</p>
            <Button variant="primary" disabled={blocked || Date.parse(preview.expiresAt) <= now} onClick={() => void act(() => command(item, { action: "confirm", key: crypto.randomUUID(), previewToken: preview.token }))}>Confirm these changes</Button>
          </div>}
        </li>;
      })}</ul>
      <a className={`${buttonClass("secondary")} mt-4`} href={`/ebooks/review?run=${batch.runId}`}>Review uploaded eBooks</a>
    </section>}
  </div>;
}
