"use client";

import { useCallback, useState, useRef } from "react";
import { uploadMediaFile, mediaResponseError } from "@/lib/utils/media-upload";
import { Upload } from "lucide-react";
import type { MediaType } from "@/lib/types";
import type { MonochromeParams } from "@/lib/validations/media";

interface UploadZoneProps {
  entityType: "work" | "author" | "collection";
  entityId: string;
  mediaType: MediaType;
  onUploadComplete?: () => void;
  className?: string;
  accept?: string;
  multiple?: boolean;
  processingParams?: MonochromeParams;
}

interface UploadState {
  id: string;
  filename: string;
  error?: string;
  status: "uploading" | "done" | "error";
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
  accept = "image/*",
  multiple = false,
  processingParams,
}: UploadZoneProps) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      const id = crypto.randomUUID();
      setUploads((prev) => [
        ...prev,
        { id, filename: file.name, status: "uploading" },
      ]);

      try {
        await uploadMediaFile(() => {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("entityType", entityType);
          formData.append("entityId", entityId);
          formData.append("mediaType", mediaType);
          if (processingParams)
            formData.append(
              "processingParams",
              JSON.stringify(processingParams),
            );
          return formData;
        });

        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: "done" } : u)),
        );

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
    },
    [entityType, entityId, mediaType, onUploadComplete, processingParams],
  );

  const processUrl = useCallback(
    async (imageUrl: string) => {
      const filename =
        imageUrl.split("/").pop()?.split("?")[0]?.slice(0, 40) ||
        "dragged-image";

      const id = crypto.randomUUID();
      setUploads((prev) => [...prev, { id, filename, status: "uploading" }]);

      try {
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

        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: "done" } : u)),
        );

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
    },
    [entityType, entityId, mediaType, onUploadComplete, processingParams],
  );

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

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-sm border-2 border-dashed px-4 py-6 transition-colors ${
          isDragging
            ? "border-accent-rose bg-accent-rose/5"
            : "border-glass-border hover:border-fg-muted/30"
        }`}
      >
        <Upload className="mb-2 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
        <p className="text-xs text-fg-muted">
          Drop {mediaType} image{multiple ? "s" : ""} here or click to browse
        </p>
        <p className="mt-0.5 text-[10px] text-fg-muted/60">
          Drag from browser or file system
        </p>
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
      </div>

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
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {u.filename}
                </span>
                <span
                  className={
                    u.status === "error"
                      ? "text-accent-red"
                      : "animate-pulse text-fg-muted"
                  }
                >
                  {u.status === "error"
                    ? "Failed"
                    : "Uploading and processing…"}
                </span>
                {u.status === "error" && (
                  <button
                    type="button"
                    className="text-fg-muted hover:text-fg-primary"
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
              {u.error && <p className="mt-1 text-accent-red">{u.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
