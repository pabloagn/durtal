"use client";
import { useEffect, useState } from "react";
import { ReaderView } from "@/app/reader/[ebookId]/reader-view";
import { getReaderRuntime } from "@/lib/reader/offline/runtime";
import { BOOKS_CACHE } from "@/lib/reader/offline/downloads";
import { bookCacheUrl, type DownloadRecord } from "@/lib/reader/offline/download-record";

export function OfflineReader() {
  const [record,setRecord] = useState<DownloadRecord | null>(null), [message,setMessage] = useState("Opening your downloaded book");
  useEffect(() => {
    let active = true;
    void (async () => {
      const params = new URLSearchParams(location.search), ebookId=params.get("ebookId"), fileId=params.get("file"), sha=params.get("sha");
      // An address that names no book asks for one, rather than saying it is not downloaded (SLN-685)
      if (!ebookId) { if (active) setMessage("No book was chosen. Choose one of your downloaded books to read it."); return; }
      const records = await (await getReaderRuntime()).store.listDownloads();
      const saved = records.find(row => row.state === "ready" && row.identity.ebookId === ebookId &&
        (!fileId || row.identity.fileId === fileId) && (!sha || row.identity.sha256 === sha));
      if (!saved || !await (await caches.open(BOOKS_CACHE)).match(bookCacheUrl(saved.identity,location.origin))) {
        if (active) setMessage("This book is not downloaded on this device. Open it online to download it."); return;
      }
      if (active) setRecord(saved);
    })().catch(() => { if (active) setMessage("The downloaded book could not be read on this device."); });
    return () => { active = false; };
  },[]);
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- The service worker serves this cached shell only for document navigations.
  if (!record) return <main className="space-y-4 p-6"><p role="status" className="type-body text-fg-secondary">{message}</p><a className="type-body text-accent-primary" href="/ebooks/offline">Downloaded books</a></main>;
  const file=record.identity, url=`/api/ebooks/files/${file.fileId}?durtal-sha=${file.sha256}`;
  return <ReaderView ebook={{ id: file.ebookId, ...record.book }}
    file={{ id: file.fileId, format: file.format, size: file.sizeBytes, sha256: file.sha256, url, fallbackUrl: url, expiresAt: null, cdOffset: null }}
    deviceId={record.deviceId} place={null} devicePlace={null} otherPlace={null} alternatives={[]}
    backHref="/ebooks/offline" plugins={[]} localPreferenceAdmission />;
}
