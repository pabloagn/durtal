"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AnnotationControllerSnapshot } from "@/lib/reader/annotation-controller";
import type { PendingAnnotation } from "@/lib/reader/sync/annotation-outbox";
export function annotationProblemDraft(row: PendingAnnotation): string {
  const mutation = row.mutation;
  return mutation.op === "put" ? [mutation.text, mutation.note].filter(Boolean).join("\n\n") : mutation.op === "note" ? mutation.note ?? "" : mutation.op === "reanchor" ? mutation.locator.text?.highlight ?? "" : [row.snapshot?.text,row.snapshot?.note].filter(Boolean).join("\n\n");
}
export function AnnotationConflicts({ snapshot, onRefresh, onRetry }: { snapshot: AnnotationControllerSnapshot; onRefresh(): Promise<void>; onRetry(operationId: string, revision: number): Promise<boolean> }) {
  const [hidden, setHidden] = useState(new Set<string>()), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const urls = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; const current = urls.current; return () => { alive.current = false; current.forEach(url => URL.revokeObjectURL(url)); }; }, []);
  const [page, setPage] = useState(0);
  const problems: { operation: PendingAnnotation; state: "blocked" | "rejected" | "ignored" | "conflict"; reason: string }[] = [...(snapshot.problems ?? [])];
  for (const conflict of snapshot.conflicts) {
    const operation = snapshot.pending.find(row => row.operationId === conflict.operationId);
    if (operation && !problems.some(item => item.operation.operationId === conflict.operationId)) problems.push({ operation, state: "conflict", reason: conflict.reason });
  }
  const download = (operation: PendingAnnotation) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(operation,null,2)+"\n"],{ type: "application/json" })); urls.current.add(url);
    const link = document.createElement("a"); link.href = url; link.download = `annotation-draft-${operation.operationId}.json`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); },30000);
  };
  const shown = problems.filter(item => !hidden.has(`${item.operation.operationId}:${item.operation.revision}:${item.state}`));
  const visiblePage = Math.min(page,Math.max(0,Math.ceil(shown.length/50)-1));
  if (!shown.length && !snapshot.error) return null;
  return <section aria-label="Annotation save conflicts" className="flex flex-col gap-3">
    <p className="text-sm text-fg-secondary">Some changes need attention. Their original drafts remain saved on this device.</p>
    {snapshot.error && <p role="alert" className="text-sm text-accent-red-text">{snapshot.error}</p>}
    <Button variant="ghost" size="sm" onClick={() => { void onRefresh().catch(() => { if (alive.current) setMessage("Saved marks could not be refreshed."); }); }}>Refresh saved marks</Button>
    {shown.slice(visiblePage*50,(visiblePage+1)*50).map(item => {
      const row = item.operation, key = `${row.operationId}:${row.revision}:${item.state}`, draft = annotationProblemDraft(row);
      const saved = snapshot.annotations.find(annotation => annotation.id === row.mutation.id);
      return <div key={key} className="flex flex-col gap-2 rounded-sm border border-border-primary p-3">
        <p className="text-sm text-fg-secondary">{item.reason === "authentication" ? "Sign in on the device that made this change, then retry." : item.reason === "deleted" || item.reason === "missing" ? "The saved mark was removed. Your local draft is retained." : "The saved mark changed before this edit could be saved."}</p>
        {draft && <p className="whitespace-pre-wrap break-words text-sm">{draft}</p>}
        {saved?.note && <details><summary className="min-h-11 cursor-pointer text-sm">Show saved note</summary><p className="whitespace-pre-wrap break-words text-sm text-fg-secondary">{saved.note}</p></details>}
        <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => download(row)}>Download local draft</Button>
          {item.state === "blocked" && item.reason === "authentication" && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => { setBusy(key); void onRetry(row.operationId,row.revision).then(changed => { if (alive.current) setMessage(changed ? "Original change queued again." : "Retry needs the original signed-in device, or the saved change has moved on."); }).catch(() => { if (alive.current) setMessage("Retry failed. Your draft remains saved."); }).finally(() => { if (alive.current) setBusy(null); }); }}>Retry after sign-in</Button>}
          {(item.state === "rejected" || item.state === "ignored") && <Button variant="ghost" size="sm" onClick={() => setHidden(current => new Set(current).add(key))}>Hide until panel reopens</Button>}
        </div>
      </div>;
    })}
    {shown.length > 50 && <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={visiblePage === 0} onClick={() => setPage(visiblePage-1)}>Previous conflicts</Button><Button variant="ghost" size="sm" disabled={(visiblePage+1)*50 >= shown.length} onClick={() => setPage(visiblePage+1)}>More conflicts</Button></div>}
    {message && <p role="status" className="text-xs text-fg-secondary">{message}</p>}
  </section>;
}
