"use client";

import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { FileIcon } from "lucide-react";

interface CommentAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  s3Key: string;
  isImage: boolean;
  thumbnailUrl: string | null;
}

interface CommentAttachmentListProps {
  attachments: CommentAttachment[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function CommentAttachmentList({
  attachments,
}: CommentAttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment) =>
        attachment.isImage ? (
          <div key={attachment.id} className="relative">
          <a
            href={attachment.thumbnailUrl ?? `/api/media/files/${attachment.s3Key}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-sm border border-glass-border bg-bg-tertiary"
          >
            <img
              src={`/api/s3/read?key=${encodeURIComponent(attachment.s3Key)}`}
              alt={attachment.fileName}
              className="h-16 w-16 object-cover"
            />
          </a>
          <ImageAdjustButton source={`/api/s3/read?key=${encodeURIComponent(attachment.s3Key)}`} className="absolute bottom-0.5 right-0.5" />
          </div>
        ) : (
          <div
            key={attachment.id}
            className="flex items-center gap-1.5 rounded-sm border border-glass-border bg-bg-tertiary px-2 py-1"
          >
            <FileIcon className="h-3.5 w-3.5 text-fg-muted" />
            <span className="max-w-[120px] truncate text-xs text-fg-secondary">
              {attachment.fileName}
            </span>
            <span className="font-mono text-micro text-fg-muted">
              {formatFileSize(attachment.fileSize)}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
