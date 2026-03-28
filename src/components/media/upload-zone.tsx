"use client";

import { useCallback, useState, useRef } from "react";
import { Upload, X } from "lucide-react";
import type { MediaType } from "@/lib/types";

interface UploadZoneProps {
  entityType: "work" | "author";
  entityId: string;
  mediaType: MediaType;
  onUploadComplete?: () => void;
  className?: string;
  accept?: string;
  multiple?: boolean;
}

interface UploadState {
  filename: string;
  progress: number;
  status: "uploading" | "processing" | "done" | "error";
}

export function UploadZone({
  entityType,
  entityId,
  mediaType,
  onUploadComplete,
  className = "",
  accept = "image/*",
  multiple = false,
}: UploadZoneProps) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      const idx = uploads.length;
      setUploads((prev) => [
        ...prev,
        { filename: file.name, progress: 0, status: "uploading" },
      ]);

      try {
        // 1. Get presigned URL
        const presignRes = await fetch("/api/media/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "presign",
            entityType,
            entityId,
            filename: file.name,
            contentType: file.type,
          }),
        });
        const { url, bronzeKey, fileId } = await presignRes.json();

        // 2. Upload to S3
        setUploads((prev) =>
          prev.map((u, i) => (i === idx ? { ...u, progress: 30 } : u)),
        );

        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        // 3. Process
        setUploads((prev) =>
          prev.map((u, i) =>
            i === idx ? { ...u, progress: 70, status: "processing" } : u,
          ),
        );

        await fetch("/api/media/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "process",
            entityType,
            entityId,
            mediaType,
            fileId,
            bronzeKey,
            originalFilename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        });

        setUploads((prev) =>
          prev.map((u, i) =>
            i === idx ? { ...u, progress: 100, status: "done" } : u,
          ),
        );

        onUploadComplete?.();
      } catch {
        setUploads((prev) =>
          prev.map((u, i) =>
            i === idx ? { ...u, status: "error" } : u,
          ),
        );
      }
    },
    [entityType, entityId, mediaType, onUploadComplete, uploads.length],
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
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
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
            : "border-bg-tertiary hover:border-fg-muted/30"
        }`}
      >
        <Upload className="mb-2 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
        <p className="text-xs text-fg-muted">
          Drop {mediaType} image{multiple ? "s" : ""} here or click to browse
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Upload progress */}
      {activeUploads.length > 0 && (
        <div className="mt-2 space-y-1">
          {activeUploads.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className={`h-full transition-all ${
                    u.status === "error" ? "bg-red-500" : "bg-accent-rose"
                  }`}
                  style={{ width: `${u.progress}%` }}
                />
              </div>
              <span className="text-[10px] text-fg-muted">
                {u.status === "error" ? "Failed" : u.status === "processing" ? "Processing..." : `${u.progress}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
