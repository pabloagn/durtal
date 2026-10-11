"use client";
import { useCallback, useEffect, useState } from "react";
import { SectionHeading } from "@/components/shared/section-heading";
import { getReaderRuntime } from "@/lib/reader/offline/runtime";
import { BOOKS_CACHE, removeDownload } from "@/lib/reader/offline/downloads";
import { bookCacheUrl, type DownloadRecord } from "@/lib/reader/offline/download-record";

/** A data-independent list. Importing this component never mounts an engine. */
export function OfflineDownloadList() {
  const [rows,setRows] = useState<{ record: DownloadRecord; available: boolean }[]>([]);
  const [message,setMessage] = useState("Loading downloads");
  const load = useCallback(async () => {
    try {
      const store = (await getReaderRuntime()).store, cache = await caches.open(BOOKS_CACHE);
      const records = await store.listDownloads();
      const result = await Promise.all(records.map(async record => ({ record,
        available: record.state === "ready" && !!await cache.match(bookCacheUrl(record.identity,location.origin)) })));
      setRows(result); setMessage(result.length ? "" : "No books have been downloaded on this device.");
    } catch { setMessage("Downloads could not be read on this device."); }
  },[]);
  useEffect(() => { void load(); },[load]);
  async function remove(record: DownloadRecord) {
    try { await removeDownload((await getReaderRuntime()).store,record,location.origin); await load(); }
    catch { setMessage("The download could not be removed. Try again."); }
  }
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
    <SectionHeading title="Downloaded books" />
    <p className="type-body text-fg-secondary">Books saved here open without a connection. The browser may clear stored books and unsynced changes; sync before clearing device storage.</p>
    {message && <p role="status" className="type-body text-fg-secondary">{message}</p>}
    <ul className="space-y-4">{rows.map(({ record,available }) => <li key={record.key} className="space-y-2 border-b border-border-subtle pb-4">
      <p className="type-item-title break-words">{record.book.title}</p>
      <p className="type-body break-words text-fg-secondary">{record.book.authors.join(", ")}</p>
      <div className="flex flex-wrap gap-4 type-body">
        {available ? <a className="text-accent-primary" href={`/reader/offline?ebookId=${record.identity.ebookId}&file=${record.identity.fileId}&sha=${record.identity.sha256}`}>Read offline</a>
          : <span className="text-fg-secondary">{record.state === "downloading" ? "Download interrupted or in progress" : record.failure ?? "The browser removed this file"}</span>}
        <button type="button" className="text-accent-primary" onClick={() => void remove(record)}>Remove download</button>
      </div>
    </li>)}</ul>
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Leaving the cached offline shell needs a document navigation, not an RSC request. */}
    <a className="type-body text-accent-primary" href="/ebooks">Browse the online library</a>
  </main>;
}
