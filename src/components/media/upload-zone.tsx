"use client";

import { useCallback, useState, useRef } from "react";
import { uploadMediaFile, mediaResponseError } from "@/lib/utils/media-upload";
import { Upload } from "lucide-react";
import type { MediaType } from "@/lib/types";
import type { MonochromeParams } from "@/lib/validations/media";
import { IMAGE_ACCEPT, imageFileRefusal } from "@/lib/validations/media-security";
import { pageUploadQueue } from "@/lib/utils/upload-queue";
import { countLabel } from "@/lib/utils/format";

interface ZoneOptions {
  onUploadComplete?: () => void;
  className?: string;
  accept?: string;
  multiple?: boolean;
  processingParams?: MonochromeParams;
  /** What the image is called in the drop prompt: defaults to the media type ("poster") */
  noun?: string;
}

/** Where an image goes that is not a media row: an edition's cover (SLN-638) */
export interface UploadTarget {
  file: (file: File) => Promise<void>;
  url: (imageUrl: string) => Promise<void>;
}

type UploadZoneProps = ZoneOptions &
  (
    | {
        entityType:
          | "work"
          | "author"
          | "collection"
          | "perfume_variant"
          | "organization";
        entityId: string;
        mediaType: MediaType;
        send?: never;
      }
    | {
        send: UploadTarget;
        noun: string;
        entityType?: never;
        entityId?: never;
        mediaType?: never;
      }
  );

interface UploadState {
  id: string;
  filename: string;
  error?: string;
  status: "queued" | "uploading" | "done" | "error";
}

/**
 * Extract an image URL from drag-and-drop DataTransfer data.
 * When dragging an image from a browser, the event carries the URL
 * in HTML (<img src="...">) or as a URI list — not necessarily as a File.
 */
function extractImageUrl(
  html: string,
  uriList: string,
  text: string,
): string | null {
  // 1. HTML with <img> tag — most reliable signal for image drags
  if (html) {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match?.[1]) {
      const src = match[1].replace(/&amp;/g, "&");
      if (src.startsWith("http")) return src;
    }
  }

  // 2. URI list — check for image-like URLs
  if (uriList) {
    const url = uriList
      .split("\n")
      .find((line) => !line.startsWith("#") && line.trim().startsWith("http"));
    if (url) {
      const trimmed = url.trim();
      if (/\.(jpe?g|png|gif|webp|avif|bmp|tiff?)([?#]|$)/i.test(trimmed)) {
        return trimmed;
      }
      // For CDN URLs without extensions (e.g., Google Images), accept if
      // the HTML also had an img tag pointing here (already handled above).
      // As a fallback, accept any http URL from uri-list since the user
      // explicitly dragged something.
      if (html.includes("<img")) return trimmed;
    }
  }

  // 3. Plain text that looks like an image URL
  const trimmedText = text?.trim();
  if (
    trimmedText &&
    /^https?:\/\/.+\.(jpe?g|png|gif|webp|avif|bmp|tiff?)([?#]|$)/i.test(
      trimmedText,
    )
  ) {
    return trimmedText;
  }

  return null;
}

/** Convert a data: URI to a File object for the standard upload path. */
function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], `${filename}.${ext}`, { type: mime });
}

export function UploadZone({
  entityType,
  entityId,
  mediaType,
  onUploadComplete,
  className = "",
  accept = IMAGE_ACCEPT,
  multiple = false,
  processingParams,
  noun,
  send,
}: UploadZoneProps) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A few at a time, so a gallery drop never sends every photo at once; one
  // queue for the page, so a drop zone reopened while one is sending still
  // waits its turn (SLN-1461)
  const queue = pageUploadQueue();
  const [cancelled, setCancelled] = useState<number | null>(null);
  // Cancel unmounts itself, so the focus moves to the note saying what happened
  const focusNote = useCallback((note: HTMLParagraphElement | null) => note?.focus(), []);

  const enqueue = useCallback(
    (filename: string, upload: () => Promise<void>) => {
      const id = crypto.randomUUID();
      setCancelled(null);
      // A new batch starts the count of what was added afresh
      setUploads((prev) => [
        ...(prev.some((u) => u.status === "queued" || u.status === "uploading")
          ? prev
          : prev.filter((u) => u.status !== "done")),
        { id, filename, status: "queued" },
      ]);
      queue.add(id, async () => {
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: "uploading" } : u)));
        try {
          await upload();
          setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: "done" } : u)));
          onUploadComplete?.();
        } catch (error) {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === id
                ? {
                    ...u,
                    status: "error",
                    error:
                      error instanceof Error
                        ? error.message
                        : "The connection was interrupted. Check the media list before trying again.",
                  }
                : u,
            ),
          );
        }
      });
    },
    [queue, onUploadComplete],
  );

  const processFile = useCallback(
    (file: File) => {
      // Too large, or a type the server refuses: said at once, nothing sent
      const refused = imageFileRefusal(file);
      if (refused) {
        setUploads((prev) => [
          ...prev,
          { id: crypto.randomUUID(), filename: file.name, status: "error", error: refused },
        ]);
        return;
      }
      enqueue(file.name, () =>
        send
          ? send.file(file)
          : uploadMediaFile(() => {
              const formData = new FormData();
              formData.append("file", file);
              formData.append("entityType", entityType!);
              formData.append("entityId", entityId!);
              formData.append("mediaType", mediaType!);
              if (processingParams)
                formData.append(
                  "processingParams",
                  JSON.stringify(processingParams),
                );
              return formData;
            }),
      );
    },
    [entityType, entityId, mediaType, processingParams, send, enqueue],
  );

  const processUrl = useCallback(
    (imageUrl: string) => {
      const filename =
        imageUrl.split("/").pop()?.split("?")[0]?.slice(0, 40) ||
        "dragged-image";

      enqueue(filename, async () => {
        if (send) return send.url(imageUrl);
        const res = await fetch("/api/media/from-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType,
            entityId,
            mediaType,
            imageUrl,
            ...(processingParams ? { processingParams } : {}),
          }),
        });

        if (!res.ok) throw await mediaResponseError(res);
      });
    },
    [entityType, entityId, mediaType, processingParams, send, enqueue],
  );

  /** Drops the photos not yet sent; the ones being sent finish and are kept */
  const cancelWaiting = useCallback(() => {
    const dropped = new Set(queue.cancel());
    setUploads((prev) => prev.filter((u) => !dropped.has(u.id)));
    setCancelled(dropped.size);
  }, [queue]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return;
      Array.from(files).forEach(processFile);
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      // Extract all data synchronously — DataTransfer is cleared after the handler returns
      const files = e.dataTransfer.files;
      const html = e.dataTransfer.getData("text/html");
      const uriList = e.dataTransfer.getData("text/uri-list");
      const text = e.dataTransfer.getData("text/plain");

      // 1. Actual image files (local file drops, or browser-provided files)
      const imageFiles = Array.from(files).filter(
        (f) => f.type.startsWith("image/") && f.size > 0,
      );
      if (imageFiles.length > 0) {
        for (const file of imageFiles) processFile(file);
        return;
      }

      // 2. Image URL from browser drag (e.g., dragging an image from another tab)
      const imageUrl = extractImageUrl(html, uriList, text);
      if (imageUrl) {
        // Handle data: URIs client-side (convert to File, use standard upload)
        if (imageUrl.startsWith("data:")) {
          processFile(dataUrlToFile(imageUrl, "dragged-image"));
          return;
        }
        processUrl(imageUrl);
      }
    },
    [processFile, processUrl],
  );

  const activeUploads = uploads.filter((u) => u.status !== "done");
  const waiting = uploads.filter((u) => u.status === "queued").length;
  const sending = uploads.filter((u) => u.status === "uploading").length;
  const added = uploads.filter((u) => u.status === "done").length;

  return (
    <div className={className}>
      {/* A button, so the keyboard reaches it: Enter or Space opens the file picker (SLN-904) */}
      <button
        type="button"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed px-4 py-6 transition-colors ${
          isDragging
            ? "border-accent-primary bg-accent-primary/5"
            : "border-glass-border hover:border-fg-muted/30"
        }`}
      >
        <Upload className="mb-2 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
        <span className="block text-xs text-fg-secondary">
          {/* "Drop poster image here"; a main image called an image is not said twice */}
          Drop {(noun ?? mediaType) === "image" ? "" : `${noun ?? mediaType} `}image{multiple ? "s" : ""} here or click to browse
        </span>
        <span className="mt-0.5 block text-micro text-fg-secondary">
          Drag from browser or file system
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Cancel keeps what is already saved, and says how many were added (SLN-1461) */}
      {waiting > 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs" role="status">
          <span className="min-w-0 flex-1 text-fg-secondary">
            {sending.toLocaleString("en")} sending, {waiting.toLocaleString("en")} waiting
          </span>
          <button
            type="button"
            className="text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11"
            onClick={cancelWaiting}
          >
            Cancel
          </button>
        </div>
      )}
      {cancelled !== null && (
        <p ref={focusNote} tabIndex={-1} className="mt-2 text-xs text-fg-secondary outline-none" role="status">
          {sending > 0
            ? `Cancelled. Finishing the ${countLabel(sending, "image")} already sending…`
            : `Cancelled. ${countLabel(added, "image")} added, ${cancelled.toLocaleString("en")} not sent.`}
        </p>
      )}

      {/* Upload progress */}
      {activeUploads.length > 0 && (
        <div className="mt-2 space-y-1">
          {activeUploads.map((u) => (
            <div
              key={u.id}
              className="text-xs"
              role={u.status === "error" ? "alert" : "status"}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-fg-secondary">
                  {u.filename}
                </span>
                <span
                  className={
                    u.status === "error"
                      ? "text-accent-red-text"
                      : u.status === "queued"
                        ? "text-fg-secondary"
                        : "animate-pulse text-fg-secondary"
                  }
                >
                  {u.status === "error"
                    ? "Failed"
                    : u.status === "queued"
                      ? "Waiting"
                      : "Uploading and processing…"}
                </span>
                {u.status === "error" && (
                  <button
                    type="button"
                    className="text-fg-secondary hover:text-fg-primary pointer-coarse:min-h-11"
                    aria-label={`Dismiss error for ${u.filename}`}
                    onClick={() =>
                      setUploads((prev) =>
                        prev.filter((item) => item.id !== u.id),
                      )
                    }
                  >
                    Dismiss
                  </button>
                )}
              </div>
              {u.error && <p className="mt-1 text-accent-red-text">{u.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
