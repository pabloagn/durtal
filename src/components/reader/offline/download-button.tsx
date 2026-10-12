"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Download, X } from "lucide-react";
import { ReaderBarItem } from "../reader-bar-item";
import type { ReaderViewFile } from "@/app/reader/[ebookId]/reader-view";
import { contentTypeFor } from "@/lib/ebooks/formats";
import { canonicalDownloadUrl, type DeliveryTrust } from "@/lib/reader/offline/download-policy";
import { downloadBook } from "@/lib/reader/offline/downloads";
import { getReaderRuntime } from "@/lib/reader/offline/runtime";
import { installOfflineRuntime } from "@/lib/reader/offline/install";

export function DownloadButton({ ebook, file, deviceId, notice }: {
  ebook: { id: string; title: string; authors: string[] }; file: ReaderViewFile;
  deviceId: string | null; notice: (message: string) => void;
}) {
  const [progress,setProgress] = useState<number | null>(null), [ready,setReady] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(),[]);
  const label = progress !== null ? `Cancel download (${progress}%)` : ready ? "Available offline" : "Make available offline";
  async function download() {
    if (abort.current) { abort.current.abort(); return; }
    if (!deviceId) { notice("Open this book online before downloading it on this device."); return; }
    const controller = new AbortController(); abort.current = controller; setProgress(0);
    try {
      const registration = await installOfflineRuntime(controller.signal);
      if (!registration) throw new Error("Offline downloads require a secure production build.");
      const trust: DeliveryTrust = { appOrigin: location.origin, cdnBases: file.cdnBases ?? [] };
      const deliveryUrl = file.expiresAt && Date.parse(file.expiresAt)<=Date.now() ? file.fallbackUrl : file.url;
      await downloadBook({ store: (await getReaderRuntime()).store, trust, deviceId, deliveryUrl,
        identity: { v: 1, ebookId: ebook.id, fileId: file.id, sha256: file.sha256, format: file.format,
          sizeBytes: file.size, contentType: contentTypeFor(file.format), canonicalUrl: canonicalDownloadUrl(deliveryUrl,trust) },
        book: { title: ebook.title, authors: ebook.authors }, signal: controller.signal,
        progress: (bytes,total) => setProgress(Math.round(bytes/total*100)) });
      setReady(true); notice("Available offline on this device.");
    } catch (error) { notice(controller.signal.aborted ? "Download cancelled." : error instanceof Error ? error.message : "The download could not be saved."); }
    finally { abort.current = null; setProgress(null); }
  }
  return <ReaderBarItem label={label} disabled={ready} onSelect={() => void download()}
    icon={progress !== null ? <X className="h-4 w-4" strokeWidth={1.5} /> : ready ? <Check className="h-4 w-4" strokeWidth={1.5} /> : <Download className="h-4 w-4" strokeWidth={1.5} />} />;
}
